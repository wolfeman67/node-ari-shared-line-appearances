'use strict';
var Q = require('q');

/**
 * Looks for an existing mixing bridge and creates one if none exist.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @return {Q} Q promise object.
 */
function designateMixingBridge(client, bridgeNum) {
  var defer = Q.defer();
  var list = Q.denodeify(client.bridges.list.bind(client));
  list().then(
      function(bridges) {
        var bridge = bridges.filter(function(candidate) {
          return (candidate['bridge_type'] === 'mixing' &&
            candidate['name'] === bridgeNum);
        })[0];
        if (bridge) {
          console.log('Using existing mixing bridge %s numbered %s', 
            bridge.id, bridge.name);
          defer.resolve(bridge);
        } else {
          var create = Q.denodeify(client.bridges.create.bind(client));
          create({type: 'mixing', name: bridgeNum})
            .then(function(bridge) {
              console.log('Created new mixing bridge %s numbered %s',
                bridge.id, bridge.name);
              defer.resolve(bridge);
            });
        }
      })
    .catch(function (err) {
      defer.reject(err);
    });
  return defer.promise;
}

/**
 * Adds created channel to the bridge.
 * @param {Object} channel - Created channel to be added to the bridge.
 * @param {Object} bridge - Bridge that channel is to be added to.
 * @return {Q} Q promise object.
 */
function addChannelsToBridge(inbound, dialed, bridge) {
  var defer = Q.defer();
  var numInBridge = 0;
  console.log('Adding channels to bridge %s', bridge.id);
  var addChannel = Q.denodeify(bridge.addChannel.bind(bridge));
  addChannel({channel: [inbound.id, dialed.id]})
    .catch(function (err) {
      defer.reject(err);
    });
  bridge.on('ChannelEnteredBridge', function(event, bridge) {
    console.log('Channel %s has entered the bridge', bridge.channel.id);
    numInBridge += 1;
  });
  bridge.on('ChannelLeftBridge', function(event, bridge) {
    numInBridge -= 1;
    console.log('Channel %s has left the bridge', bridge.channel.id);
    if(numInBridge === 1) {
      if(bridge.channel.id === inbound.id) {
        console.log('Hanging up dialed channel %s', dialed.id);
        var hangupDialed = Q.denodeify(dialed.hangup.bind(dialed));
        hangupDialed()
          .catch(function (err) {
            defer.reject(err);
          });
      }
      else if(bridge.channel.id === dialed.id) {
        console.log('Hanging up inbound channel %s', inbound.id);
        var hangupInbound = Q.denodeify(inbound.hangup.bind(inbound));
        hangupInbound()
          .catch(function (err) {
            defer.reject(err);
          });
      }
    }
    if(numInBridge === 0) {
      defer.resolve('Application completed');
    }
  });
  return defer.promise;
}

/**
 * Creates a channel to a specified endpoint and places it in the Stasis app.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {Object} bridge - Object that defines the bridge to be passed to
 *   addChannelsToBridge().
 * @return {Q} Q promise object.
 */
function createChannel(client, inbound, bridge) {
  var defer = Q.defer();
  var dialed = client.Channel();
  var originate = Q.denodeify(dialed.originate.bind(dialed));
  originate({endpoint: 'SIP/phone', app: 'sla', appArgs: 'dialed'})
    .catch(function (err) {
      defer.reject(err);
    });
  dialed.on('StasisStart', function(event, dialed) {
    var answer = Q.denodeify(dialed.answer.bind(dialed));
    answer();
    defer.resolve(dialed);
  });
  dialed.on('ChannelDestroyed', function(event, dialed) {
    defer.resolve(null);
  });
  inbound.on('ChannelHangupRequest', function(event, inbound) {
    defer.resolve(null);
    var hangup = Q.denodeify(dialed.hangup.bind(dialed));
    hangup()
      .catch(function (err) {
        defer.reject(err);
      });
  });
  return defer.promise;
}

/**
 * Receives initial input and begins the application.
 * @param {Object} client - Client received from app.js.
 * @return {Q} Q promise object.
 */
module.exports = function(client, channel, bridgeNumber) {
  //This specifies what bridge number to use for SLA
  if(!isNaN(parseInt(bridgeNumber))) {
    var answer = Q.denodeify(channel.answer.bind(channel));
    answer();
    return designateMixingBridge(client, bridgeNumber)
      .then(function (bridge) {
        return createChannel(client, channel, bridge)
          .then(function (dialed) {
            if (dialed) {
              return addChannelsToBridge(channel, dialed, bridge);
            }
            else {
              var hangup = Q.denodeify(channel.hangup.bind(channel));
              hangup(function(channel) {
                 console.log('Hanging up inbound channel %s', channel.id);
              });
              var defer = Q.defer();
              defer.resolve('Channel rejected or caller hung up');
              return defer.promise;
            }
          });
      });
  }
  else {
    var defer = Q.defer();
    var hangup = Q.denodeify(channel.hangup.bind(channel));
    hangup()
      .catch(function (err) {
        defer.reject(err);
      });
    defer.resolve('Not a numeric SLA specification: ' +  bridgeNumber);
    return defer.promise;
  }
};
