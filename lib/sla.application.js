'use strict';
var Q = require('q');

var dal = require('./core/dal.js');
var customError = require('./customError.js');
var isStation = require('./isStation.js');
var updateState = require('./updateState.js');
var getState = require('./getState.js');
var designateMixingBridge = require('./designateMixingBridge.js');
var originateInbound = require('./originateInbound.js');
var originateOutbound = require('./originateOutbound.js');
var addChannelsToBridge = require('./addChannelsToBridge.js');
var states = require('./states.js');

/**
 * Receives initial input and begins the application.
 * @param {Object} client - Client received from app.js.
 * @param {string} confFile - the configuration path and file name
 * @param {Object} channel - the inbound or outbound channel
 * @param {string} extensionName - the name of the extension to access
 * @return {Q} Q promise object.
 */
module.exports = function(client, confFile, channel, extensionName) {
  /**
   * Function that displays a helpful message when a channel enters a bridge
   * @param {Object} event - the event related to this bridge entering
   * @param {Object} object - contains the bridge and channel in question
   */
  function onChannelEnteringBridge(event, object) {
    console.log('Channel %s has entered the bridge', object.channel.id);
  }

  /**
   * Function that is utilized when a channel leaves the bridge.
   *   If the channel is a non-station channel, then hangs up remaining
   *   channels. If the channel is a station, checks if the only non-station
   *   channel is the only left, and then hangs up that non-station channel.
   * @param {Object} event - the event related to the bridge leaving
   * @param {Object} object - contains the bridge and channel in question
   */
  function onChannelExitingBridge(event, object) {
    if (isStation(data.extension, object.channel)) {
      if (object.bridge.channels.length === 1) {
      	// If there is only one channel left, hang up the remaining channel
        var hangup = Q.denodeify(client.channels.hangup.bind
            (client));
        hangup({channelId: object.bridge.channels[0]})
          .catch(function (err) {
            err.name = 'HangupFailure';
            throw err;
          });
      }
    } else {
      if (object.bridge.channels.length) {
        console.log('Hanging up station channel/s');
        var hangupArray = [];
        object.bridge.channels.forEach( function(ID) {
          var hangup = Q.denodeify(client.channels.hangup.bind
            (client.channels));
          hangupArray.push(hangup({channelId: ID}));
        });
        return Q.all(hangupArray);
      }
    }

    if (object.bridge.channels.length === 0) {
      console.log('Extension', bridge.name, 'now free!');
      updateState(client, bridge.name, states.IDLE);
      bridge.removeAllListeners('ChannelEnteredBridge');
      bridge.removeAllListeners('ChannelLeftBridge');
    }
  }
  var data;
  var bridge;
  var dialed;

  // If there is only one channel, then reset the list of bridges that have
  // events
  dal.getData(confFile, channel, extensionName)
    .then(function(result) {
      data = result;

      return Q.denodeify(channel.answer.bind(channel))();
    })
    .then(function() {
      return designateMixingBridge(client, extensionName);
    })
    .then(function (result) {
      bridge = result;

      if (!bridge.channels.length) {
        bridge.on('ChannelEnteredBridge', onChannelEnteringBridge);
        bridge.on('ChannelLeftBridge', onChannelExitingBridge);
      }

      if (!data.isStation) {
        return originateInbound(client, channel, bridge, data.extension);
      } else {
        return originateOutbound(client, data.extension.trunks, channel,
          bridge, states);
      }
    })
    .then(function (result) {
      dialed = result;

      return addChannelsToBridge(client, channel, dialed, bridge,
                                 data.extension);
    })
    .catch(function (err) {
      if (err.name !== 'InboundHungup' && err.name !== 'OutboundHungup' &&
          err.name !== 'OutboundHungupEarly' &&
          err.name !== 'ExtensionOccupied') {
            var hangup = Q.denodeify(channel.hangup.bind(channel));
            hangup();
          }
      throw err;
    });
};

var stateMachine = require('./core/stateMachine.js');

function buildApp(client, data, channel) {
  var state = stateMachine.create(client, data, channel);

  return {
    run: function() {
      // TODO: initialize state
      state.joinSla();
    }
  };
}

module.exports = function(client, confFilePath, channel, extension) {
  return dal.getData(confFilePath, channel, extension)
    .then(function(data) {

      return buildApp(client, data, channel);
    });
};
