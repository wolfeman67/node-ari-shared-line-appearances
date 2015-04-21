'use strict';
var Q = require('q');
var dal = require('./dal.js');
var customError = require('./customError.js');
var designateMixingBridge = require('./designateMixingBridge.js');
var originateIntoExtension = require('./originateIntoExtension.js');
var originateOutbound = require('./originateOutbound.js');
var addChannelsToBridge = require('./addChannelsToBridge.js');
var extsInUse = {};
var isStation = require('./isStation.js');
var updateState = require('./updateState.js');

var states = {
  HOLD: 'ONHOLD',
  BUSY: 'BUSY',
  INUSE: 'INUSE',
  IDLE: 'NOT_INUSE',
  RINGING: 'RINGING'
};

/**
 * Sets up an extension data object under extsInUse
 *   Also determines preliminarily if a channel is a station
 * @param {string} confFile - the configuration path and file name
 * @param {Object} channel - the inbound or outbound channel
 * @param {string} extensionName - the name of the extension to access
 */
function getData(confFile, channel, extensionName) {
  return dal.getSharedExtension(confFile, extensionName)
    .then(function(result) {
      if (!extsInUse[extensionName]) {
        extsInUse[extensionName] = result;
        extsInUse[extensionName].currentTrunk;
        extsInUse[extensionName].removeStation = removeStation;
        extsInUse[extensionName].removeTrunk = removeTrunk;
        extsInUse[extensionName].currentStations = [];
        extsInUse[extensionName].currentState = states.IDLE;
      }
      return isStation(extsInUse[extensionName], channel);
    });
}

/**
 * Removes a trunk from the list of current trunks of this sharedExtension
 * @param {String} channelName - the name of the channel
 */
var removeTrunk = function() {
  this.currentTrunk = null;
}

/**
 * Removes a trunk from the list of current stations of this sharedExtension
 * @param {String} channelName - the name of the channel
 */
var removeStation = function(channelName) {
  var index = this.currentStations.indexOf(channelName);
  if (index > -1) {
    this.currentStations.splice(index, 1);
  } else {
    throw new customError.CustomError('BadStationRemoval', 'Attempted to ' +
        'remove a station from the array of currentStations');
  }
}

/**
 * Frees an extension from the array of extension in use
 * param {String} extensionName - the name of the extension to remove
 */
var freeExtension = function(extensionName) {
  console.log('Extension freed!');
  delete extsInUse[extensionName];
}
extsInUse.freeExtension = freeExtension;

/**
 * Receives initial input and begins the application.
 * @param {Object} client - Client received from app.js.
 * @param {string} confFile - the configuration path and file name
 * @param {Object} channel - the inbound or outbound channel
 * @param {string} extensionName - the name of the extension to access
 * @return {Q} Q promise object.
 */
module.exports = function(client, confFile, channel, extensionName) {
  var bridge;
  var channels = [];
  var isStation;

  return getData(confFile, channel, extensionName)
    .then(function(result) {
      isStation = result;
      return Q.denodeify(channel.answer.bind(channel))();
    })
    .then(function() {
      return designateMixingBridge(client, extsInUse, extensionName, states);
    })
    .then(function (result) {
      bridge = result;

      if (!isStation) {
        return originateIntoExtension(client, extsInUse, channel, bridge,
          states);
      } else {
        extsInUse[extensionName].currentStations.push(channel.name);
        return originateOutbound(client, extsInUse, channel, bridge, states);
      }
    })
    .then(function (result) {
      channels.push(channel);
      if (result) {
        channels.push(result);
      }

      return addChannelsToBridge(client, channels, bridge, states);
    })
    .then(function() {
      return 'Channels ' + extensionName + ' added!';
    })
    .catch(function (err) {
      if (err.name !== 'InboundHungup' && err.name !== 'OutboundHungup' &&
          err.name !== 'OutboundHungupEarly' &&
          err.name !== 'ExtensionOccupied') {
            var hangup = Q.denodeify(channel.hangup.bind(channel));
            hangup();
          }
      if (extsInUse[extensionName] &&
          !extsInUse[extensionName].currentTrunk &&
          !extsInUse[extensionName].currentStations) {
            freeExtension(extensionName);
        }
      throw err;
    });
};
