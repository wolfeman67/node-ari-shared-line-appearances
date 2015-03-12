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
 * @ param {Object} trunkData - the data of the trunk to be used for station
 *   access.
 * @return {Q} Q promise object.
 */
function originateChannel(client, inbound, bridge, trunkData) {
  var defer = Q.defer();
  var originate = [];
  var numToHangup;
  var dialed = [];

  function dialedEnteredStasis(event, line) {
    var answer = Q.denodeify(line.answer.bind(line));
    answer();
    var toKill = dialed.filter(function (unanswered) {
      return unanswered.id !== line.id;
    });
    toKill.forEach(function (unanswered) {
      unanswered.removeListener('ChannelDestroyed', dialedChannelHungup);
      var hangup = Q.denodeify(unanswered.hangup.bind(unanswered));
      hangup();
    });
    defer.resolve(line);
  }

  function dialedChannelHungup(event) {
    numToHangup -= 1;
    if(numToHangup === 0) {
      inbound.removeListener('ChannelHangupRequest', inboundHungup);
      defer.resolve('Dialed channels hungup');
    }
  }

  function inboundHungup(event, line) {
    dialed.forEach(function (unanswered) {
      unanswered.removeListener('ChannelDestroyed', dialedChannelHungup);
      var hangup = Q.denodeify(unanswered.hangup.bind(unanswered));
      hangup();
    });
    defer.resolve('Inbound channel hungup');
  }

  trunkData.getAllStations()
    .then(function (stations) {
      if (stations.length) {
        stations.forEach(function() {
          dialed.push(client.Channel());
        });
        numToHangup = dialed.length;
        dialed.forEach(function (channel, i, dialed) {
          originate.push(Q.denodeify(channel.originate.bind(dialed[i])));
          originate[i]({endpoint: stations[i].endpoint, app: 'sla',
            appArgs: 'dialed', timeout: 10})
            .catch(function (err) {
              defer.reject(err);
            });
          channel.once('StasisStart', dialedEnteredStasis);
          channel.once('ChannelDestroyed', dialedChannelHungup);
        });
        inbound.once('ChannelHangupRequest', inboundHungup);
      }
      else {
        defer.reject(new CustomError('NoStations',
              'No stations in this trunk.'));
      }
    });
  return defer.promise;
}

/** 
 * Utility function for checking if the bridgeName exists in the configuration
 * file (is valid).
 * @param {String} configurationFile - the path and filename associated with the
 * cofiguration file 
 * @param {String} extension - the name of the extension (and trunk so far)
 * to be created/used
 * @return {Q} - Q promise object
 */
function getTrunkData (configurationFile, extension) {
  var defer = Q.defer();
  dal.getSharedExtension(configurationFile, extension)
    .then(function(sharedExtension) {
    sharedExtension.getTrunk(extension).then(function(trunk) {
      defer.resolve(trunk);
    })
    .catch(function(invalid) {
      defer.reject(new CustomError('InvalidTrunkSpecification', invalid));
    });
  })
  .catch(function(invalid) {
    if(invalid === 'Invalid specified extension: ' + extension) {
      defer.reject(new CustomError('InvalidSpecification', invalid));
    } else {
      defer.reject(new CustomError('InvalidConfiguration', invalid.message));
    }
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
 * @param {string} confFile - the configuration path and file name
 * @param {string} extension - the name of the extension to access
 * @return {Q} Q promise object.
 */
module.exports = function(client, inbound, confFile, extension) {
  //This specifies what bridge number to use for SLA
  return getTrunkData(confFile, extension)
    .then(function(trunk) {
      var answer = Q.denodeify(inbound.answer.bind(inbound));
      return answer()
        .then(function() {
          return designateMixingBridge(client, extension);
        }).then(function (bridge) {
          return originateChannel(client, inbound, bridge, trunk)
            .then(function (dialed) {
              // If dialed is an actual channel, it will not be a string
              if (typeof dialed !== 'string') {
                return addChannelsToBridge(inbound, dialed, bridge);
              }
              else {
                throw new CustomError('EarlyHangup',
                  dialed);
              }
            });
        });
    })
  .catch(function (err) {
    if(err.message !== 'Inbound channel hungup') {
      var hangup = Q.denodeify(inbound.hangup.bind(inbound));
      hangup();
    }
    return Q.reject(err);
  });
};
