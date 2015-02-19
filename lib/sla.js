'use strict';
var Q = require('q');

/**
 * Looks for an existing mixing bridge and creates one if none exist.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {String} bridgeName - the name of the bridge to be created/designated
 * @return {Q} Q promise object.
 */
function designateMixingBridge(client, bridgeName) {
  var defer = Q.defer();
  var list = Q.denodeify(client.bridges.list.bind(client));
  list().then(
      function(bridges) {
        var bridge = bridges.filter(function(candidate) {
          return (candidate['bridge_type'] === 'mixing' &&
            candidate['name'] === bridgeName);
        })[0];
        if (bridge) {
          console.log('Using existing mixing bridge %s numbered %s', 
            bridge.id, bridge.name);
          defer.resolve(bridge);
        } else {
          var create = Q.denodeify(client.bridges.create.bind(client));
          create({type: 'mixing', name: bridgeName})
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
 * Adds inbound and originated channels to the bridge.
 * @param {Object} inbound - Incoming channel to be added to the bridge.
 * @param {Object} dialed - Created/dialed channel to be added as well
 * @param {Object} bridge - Bridge that channels are to be added to.
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
 * Originates a channel to a specified endpoint and places it in the Stasis app.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {Object} inbound- the inbound channel
 * @param {Object} bridge - Object that defines the bridge to be passed to
 *   addChannelsToBridge().
 * @return {Q} Q promise object.
 */
function originateChannel(client, inbound, bridge) {
  var defer = Q.defer();
  var dialed = client.Channel();
  var originate = Q.denodeify(dialed.originate.bind(dialed));
  originate({endpoint: 'SIP/100@tcambron', app: 'sla', appArgs: 'dialed'})
    .catch(function (err) {
      defer.reject(err);
      
    });
  dialed.once('StasisStart', function(event, dialed) {
    var answer = Q.denodeify(dialed.answer.bind(dialed));
    answer();
    defer.resolve(dialed);
  });
  dialed.once('ChannelDestroyed', function(event, dialed) {
    defer.resolve(null);
  });
  inbound.once('ChannelHangupRequest', function(event, inbound) {
    var hangup = Q.denodeify(dialed.hangup.bind(dialed));
    hangup();
    defer.resolve(null);
  });
  return defer.promise;
}

/** Simple utility function for checking if the bridgeName is numerical
 * @param {String} bridgeName - the name of the bridge to be created/used
 * @return {boolean} whether or not the bridgeName is numerical
 */
function checkIfNum (string) {
  if(!isNaN(parseInt(string))) {
    return true;
  }
  else {
    return false;
  }
}

/**
 * Receives initial input and begins the application.
 * @param {Object} client - Client received from app.js.
 * @return {Q} Q promise object.
 */
module.exports = function(client, inbound, bridgeName) {
  //This specifies what bridge number to use for SLA
  if(checkIfNum(bridgeName)) {
    var answer = Q.denodeify(inbound.answer.bind(inbound));
    return answer()
    .then(function() {
      return designateMixingBridge(client, bridgeName)
        .then(function (bridge) {
          return originateChannel(client, inbound, bridge)
            .then(function (dialed) {
              if (dialed) {
                return addChannelsToBridge(inbound, dialed, bridge);
              }
              else {
                var hangup = Q.denodeify(inbound.hangup.bind(inbound));
                hangup();
                return 'Channel rejected or caller hung up';
              }
            });
        });
    });
  }
  else {
    var hangup = Q.denodeify(inbound.hangup.bind(inbound));
    hangup();
    return Q.reject(new Error('Not a numeric SLA specifcation: ' + bridgeName));
  }
};
