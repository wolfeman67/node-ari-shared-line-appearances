var Q = require('q');
var isStation = require('./isStation.js');
var updateState = require('./updateState.js');
var customError = require('./customError.js');

/**
 * Looks for an existing mixing bridge and creates one if none exist.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {Object} extsInUse - the object that represents the current extensions
 *   and their bridges/channels.
 * @param {String} bridgeName - the name of the bridge to be created/designated
 * @param {Object} states - the library of states for this application
 * @return {Q} Q promise object.
 */
var designateMixingBridge = function(client, extsInUse, bridgeName, states) {
  var defer = Q.defer();
  var list = Q.denodeify(client.bridges.list.bind(client));
  var bridge;
  list().then(
      function(bridges) {
        bridge = bridges.filter(function(candidate) {
          return (candidate['bridge_type'] === 'mixing' &&
            candidate.name === bridgeName);
        })[0];

        if (bridge) {
          console.log('Using existing mixing bridge %s numbered %s',
            bridge.id, bridge.name);
          defer.resolve(addEvents(bridge));
        } else {
          var create = Q.denodeify(client.bridges.create.bind(client));
          create({type: 'mixing', name: bridgeName})
            .then(function(bridge) {
              console.log('Created new mixing bridge %s numbered %s',
                bridge.id, bridge.name);
              defer.resolve(addEvents(bridge));
            });
        }
      })
    .catch(function (err) {
      defer.reject(err);
    });
  return defer.promise;

  /**
  * Checks whether or not this is the first time using the bridge, and if so,
  *   add event listeners. If this isn't the first time, don't add listeners.
  * @param {Object} bridge - the bridge being used by this shared extension
  */
  function addEvents(bridge) {
    if (!extsInUse[bridgeName].bridgeSet) {
      bridge.on('ChannelEnteredBridge', channelEnteredBridge);
      bridge.on('ChannelLeftBridge', channelLeftBridge);
      extsInUse[bridgeName].bridgeSet = true;
    }
    return bridge;
  }

  /**
   * Function that displays a helpful message when a channel enters a bridge
   * @param {Object} event - the event related to this bridge entering
   * @param {Object} object - contains the bridge and channel in question
   */
  function channelEnteredBridge(event, object) {
    var extension = extsInUse[bridgeName];
    if (extsInUse[bridgeName].holdPressed &&
        object.bridge.channels.length === 2) {
      updateState(client, extsInUse, bridge.name, states.INUSE);
          extsInUse[bridgeName].holdPressed = false;
          var mohStop = Q.denodeify(object.bridge.stopMoh.bind(object.bridge));
          mohStop();
    }
    if (isStation(extension, object.channel)) {
      object.channel.setChannelVar({variable: 'HOLD_INTERCEPT(set)'});
      object.channel.on('ChannelHold', channelHold);
    }
    console.log('Channel %s has entered the bridge', object.channel.id);

  }

  function channelHold(event, channel) {
    extsInUse[bridgeName].holdPressed = true;
    Q.denodeify(channel.hangup.bind(channel))();
  }

  /**
   * Function that is utilized when a channel leaves the bridge
   * @param {Object} event - the event related to the bridge leaving
   * @param {Object} object - contains the bridge and channel in question
   */
  function channelLeftBridge(event, object) {
    var extension = extsInUse[bridgeName];
    if (isStation(extension, object.channel)) {
      extsInUse[bridgeName].removeStation(object.channel.name);
    } else {
      extsInUse[bridgeName].removeTrunk();
    }
    if (object.bridge.channels.length === 1) {
      var getRemainder = Q.denodeify(client.channels.get.bind(client.channels));
      getRemainder({channelId: object.bridge.channels[0]})
        .then(function(channel) {
          if (!isStation(extension, channel)) {
            if (extsInUse[bridgeName].holdPressed) {
              updateState(client, extsInUse, bridge.name, states.HOLD);
              var mohStart = Q.denodeify(object.bridge.startMoh.bind(
                object.bridge));
              mohStart();
            } else {
              var hangupRemainder = Q.denodeify(client.channels.hangup.bind
                (client.channels));
              hangupRemainder({channelId: object.bridge.channels[0]})
              .catch(function (err) {
                err.name = 'HangupFailure';
              });
            }
          }
        });
    } else if (object.bridge.channels.length === 0) {
      updateState(client, extsInUse, bridge.name, states.IDLE);
      extsInUse.freeExtension(bridgeName);
      bridge.removeAllListeners('ChannelEnteredBridge');
      bridge.removeAllListeners('ChannelLeftBridge');
    } else {
      // Resets hold detection
      extsInUse[bridgeName].holdPressed = false;
    }
  }
};

module.exports = designateMixingBridge;