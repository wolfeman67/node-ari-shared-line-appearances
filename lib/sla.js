'use strict';
var Q = require('q');
var dal = require('./dal.js');
var customError = require('./customError.js');

var busy = 'BUSY';
var inUse = 'INUSE';
var idle = 'NOT_INUSE';
var ringing = 'RINGING';

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
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {Object} inbound - Incoming channel to be added to the bridge.
 * @param {Object} dialed - Created/dialed channel to be added as well
 * @param {Object} bridge - Bridge that channels are to be added to.
 * @return {Q} Q promise object.
 */
function addChannelsToBridge(client, inbound, dialed, bridge) {
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

    if (numInBridge === 1) {
      if (object.channel.id === inbound.id) {
        console.log('Hanging up dialed channel %s', dialed.id);
        var hangupDialed = Q.denodeify(dialed.hangup.bind(dialed));
        hangupDialed()
          .catch(function (err) {
            err.name = 'HangupFailure';
            defer.reject(err);
          });
      }
      else if (object.channel.id === dialed.id) {
        console.log('Hanging up inbound channel %s', inbound.id);
        var hangupInbound = Q.denodeify(inbound.hangup.bind(inbound));
        hangupInbound()
          .catch(function (err) {
            err.name = 'HangupFailure';
            defer.reject(err);
          });
      }
    }

    if (numInBridge === 0) {
      updateState(client, bridge.name, idle);
      defer.resolve('Application completed');
      object.bridge.removeListener('ChannelEnteredBridge', channelEntered);
      object.bridge.removeListener('ChannelLeftBridge', channelLeft);
    }
  }

  bridge.on('ChannelLeftBridge', channelLeft);
  return defer.promise;
}

/**
 * Updates the state of the shared extension.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {String} name - name of the shared extension to update.
 * @param {String} state - state to update the shared extension to.
 */
function updateState(client, name, state) {
  var deviceState = Q.denodeify(client.deviceStates.update.bind(client));
  deviceState({deviceName: 'Stasis:' + name, deviceState: state});
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
  var dialed = [];
  /**
   * The function that gets called once dialed enters Stasis.
   *   Kills the other remaining stations and returns the line that picked up.
   * @param {Object} event - the information related to the StasisStart event
   * @param {Object} line - the line that has entered Stasis
   */
  function dialedEnteredStasis(event, line) {
    var answer = Q.denodeify(line.answer.bind(line));
    answer();

    updateState(client, bridge.name, inUse);

    var toKill = dialed.filter(function (unanswered) {
      if (unanswered.channel.id === line.id) {
        unanswered.channel.removeAllListeners('ChannelDestroyed');
      }
      return unanswered.channel.id !== line.id;
    });
    toKill.forEach(function (unanswered) {
      unanswered.channel.removeListener('ChannelDestroyed',
        dialedChannelHungup);

      var hangup = Q.denodeify(unanswered.channel.hangup.bind(
          unanswered.channel));
      hangup();

    });
    inbound.removeAllListeners('ChannelHangupRequest');

    defer.resolve(line);
  }

  /**
   * Utility function for cheking if all dialed channels have been hungup
   * @param {Array} dialed - the array of channels; the length is checked
   * @return {boolean} - whether or not the dialed array is empty
   */
  var allAreHungup = function(dialed) {
   return !(dialed.length);
  };

  /**
   * Utility function for finding what position a dialed channel is in dialed
   * @param {Object} channel - the channel object that is attempting to be found
   * @return {int} position - what position the channel is in the array
   *   (-1 if not found)
   */
  var findInDialed = function(channel) {
    var position = -1;
    dialed.forEach(function(object, index) {
      if (channel.id === object.channel.id) {
        position = index;
      }
    });
    return position;
  };
  
  /**
   * Function that gets called when a dialed channel hangs up
   * @param {Object} event - the event object related to this hang up
   *   Determines what channel is to be removed from dialed.
   */
  function dialedChannelHungup(event) {
    var index = findInDialed(event.channel);
    if (index !== -1) {
      dialed.splice(index,1);
    } else {
      defer.reject(new customError.CustomError('BadRemoval','Failed to remove' +
           ' element in dialed.  Element not found.'));
    }
        
    if (allAreHungup(dialed)) {
      inbound.removeListener('ChannelHangupRequest', inboundHungup);

      updateState(client, bridge.name, idle);

      defer.reject(new customError.CustomError('DialedHungup', 'Dialed ' +
            'channels hungup'));
    }
  }
  
  /**
   * Function that gets called when the inbound channel hangs up.
   *   Hangs up all dialed channels. Defers confirmation that inbound has hung
   *   up.
   * @param {Object} event - the event object related to this hang up
   */
  function inboundHungup(event, line) {
    dialed.forEach(function (unanswered) {
      unanswered.channel.removeListener(
        'ChannelDestroyed', dialedChannelHungup);

      var hangup = Q.denodeify(unanswered.channel.hangup.bind(
          unanswered.channel));
      hangup();
    });
    updateState(client, bridge.name, idle);
    defer.reject(new customError.CustomError('InboundHungup',
          'Inbound channel hungup'));
  }

  trunkData.getAllStations()
    .then(function (stations) {
      if (stations.length) {
        stations.forEach(function(station) {
          dialed.push({endpoint: station.endpoint, channel: client.Channel()});
        });

        dialed.forEach(function (object) {
          var originate = Q.denodeify(object.channel.originate.bind(
              object.channel));
          originate({endpoint: object.endpoint, app: 'sla',
              appArgs: 'dialed', timeout: 10})
            .catch(function (err) {
              defer.reject(err);
            });

          object.channel.once('StasisStart', dialedEnteredStasis);
          object.channel.once('ChannelDestroyed', dialedChannelHungup);
        });

        updateState(client, bridge.name, ringing);
        inbound.once('ChannelHangupRequest', inboundHungup);
      }
      else {
        defer.reject(new customError.CustomError('NoStations',
              'No stations in this trunk.'));
      }
    });
  return defer.promise;
}

/** 
 * Utility function for checking if the bridgeName exists in the configuration
 *   file (is valid).
 * @param {String} configurationFile - the path and filename associated with the
 *   cofiguration file 
 * @param {String} extension - the name of the extension (and trunk so far)
 *   to be created/used
 * @return {Q} - Q promise object
 */
function getTrunkData (configurationFile, extension) {
  return dal.getSharedExtension(configurationFile, extension)
    .then(function(sharedExtension) {
      return sharedExtension.getTrunk(extension).then(function(trunk) {
      return Q.resolve(trunk);
    })
    .catch(function(invalid) {
      // This will only be called if trunk and extension are not the same
      // Shouldn't be right now
      return Q.reject(new customError.CustomError('InvalidTrunkSpecification',
          invalid));
    });
  })
  .catch(function(invalid) {
    if (invalid.name === 'InvalidSpecification') {
      return Q.reject(invalid);
    } else {
      return Q.reject(new customError.CustomError('InvalidConfiguration',
          invalid.message));
    }
  });
}

/**
 * Receives initial input and begins the application.
 * @param {Object} client - Client received from app.js.
 * @param {string} confFile - the configuration path and file name
 * @param {Object} inbound - the inbound channel
 * @param {string} extension - the name of the extension to access
 * @return {Q} Q promise object.
 */
module.exports = function(client, confFile, inbound, extension) {
  return getTrunkData(confFile, extension)
    .then(function(trunk) {
      var answer = Q.denodeify(inbound.answer.bind(inbound));
      return answer()
        .then(function() {
          return designateMixingBridge(client, extension);
        }).then(function (bridge) {
          return originateChannel(client, inbound, bridge, trunk)
            .then(function (dialed) {
              return addChannelsToBridge(client, inbound, dialed, bridge);
            });
        });
    })
  .catch(function (err) {
    if(err.name !== 'InboundHungup') {
      var hangup = Q.denodeify(inbound.hangup.bind(inbound));
      hangup();
    }
    return Q.reject(err);
  });
};
