'use strict';
var Q = require('q');
var dal = require('./dal.js');

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
            candidate.name === bridgeName);
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
  function channelEntered(event, object) {
    console.log('Channel %s has entered the bridge', object.channel.id);
    numInBridge += 1;
  }
  bridge.on('ChannelEnteredBridge', channelEntered);
  function channelLeft(event, object) {
    numInBridge -= 1;
    console.log('Channel %s has left the bridge', object.channel.id);
    if(numInBridge === 1) {
      if(object.channel.id === inbound.id) {
        console.log('Hanging up dialed channel %s', dialed.id);
        var hangupDialed = Q.denodeify(dialed.hangup.bind(dialed));
        hangupDialed()
          .catch(function (err) {
            err.name = 'HangupFailure';
            defer.reject(err);
          });
      }
      else if(object.channel.id === dialed.id) {
        console.log('Hanging up inbound channel %s', inbound.id);
        var hangupInbound = Q.denodeify(inbound.hangup.bind(inbound));
        hangupInbound()
          .catch(function (err) {
            err.name = 'HangupFailure';
            defer.reject(err);
          });
      }
    }
    if(numInBridge === 0) {
      defer.resolve('Application completed');
      object.bridge.removeListener('ChannelEnteredBridge', channelEntered);
      object.bridge.removeListener('ChannelLeftBridge', channelLeft);
    }
  }
  bridge.on('ChannelLeftBridge', channelLeft);
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
  dal.getAllStations(bridge.name).then(function (stations) {
    originate({endpoint: stations[0].endpoint,
      app: 'sla', appArgs: 'dialed'})
        .catch(function (err) {
          err.name = 'originateFailure';
          defer.reject(err);
        });
  });
  dialed.once('StasisStart', function(event, dialed) {
    var answer = Q.denodeify(dialed.answer.bind(dialed));
    answer();
    defer.resolve(dialed);
  });
  dialed.once('ChannelDestroyed', function(event, dialed) {
    defer.resolve('Dialed channel hungup');
  });
  inbound.once('ChannelHangupRequest', function(event, inbound) {
    var hangup = Q.denodeify(dialed.hangup.bind(dialed));
    hangup();
    defer.resolve('Inbound channel hungup');
  });
  return defer.promise;
}

/** 
 * Simple utility function for checking if the bridgeName is numerical
 * @param {String} bridgeName - the name of the bridge to be created/used
 * @return {boolean} whether or not the bridgeName is numerical
 */
function isValid (name) {
  var defer = Q.defer();
  dal.findTrunk(name).then(function(valid) {
    console.log(valid);
    defer.resolve(valid);
  })
  .catch(function(err) {
    defer.reject(new CustomError('InvalidConfiguration', err.message));
  });
  return defer.promise;
}
/** 
 * Represents an error that has both a name and message.
 * @param {String} name - the name/type of the error
 * @param {String} message - the corresponding message
 * Mainly used to avoid crashing the program, as it does with regular errors.
 */
function CustomError(name, message) {
  this.name = name;
  this.message = message;
}

/** 
 * Represents an error that has both a name and message.
 * @param {String} name - the name/type of the error
 * @param {String} message - the corresponding message
 * Mainly used to avoid crashing the program, as it does with regular errors.
 */
function CustomError(name, message) {
  this.name = name;
  this.message = message;
}

/**
 * Receives initial input and begins the application.
 * @param {Object} client - Client received from app.js.
 * @param {Object} inbound - the inbound channel
 * @param {String} bridgeName - the name of the bridge to be used/created
 * @return {Q} Q promise object.
 */
module.exports = function(client, inbound, bridgeName) {
  //This specifies what bridge number to use for SLA
  return isValid(bridgeName).then(function(valid) {
    if(valid) {
      var answer = Q.denodeify(inbound.answer.bind(inbound));
      return answer()
        .then(function() {
          return designateMixingBridge(client, bridgeName);
        }).then(function (bridge) {
          return originateChannel(client, inbound, bridge)
            .then(function (dialed) {
              // If dialed is an actual channel, it will not be a string
              if (typeof dialed !== 'string') {
                return addChannelsToBridge(inbound, dialed, bridge);
              }
              else {
                var hangup = Q.denodeify(inbound.hangup.bind(inbound));
                hangup();
                throw new CustomError('EarlyHangup',
                  dialed);
              }
            });
        });
    }
    else {
      var hangup = Q.denodeify(inbound.hangup.bind(inbound));
      hangup();
      return Q.reject(new CustomError('SLASpecficationError',
            'Not a numeric SLA specification: ' + bridgeName));
    }
  });
};
