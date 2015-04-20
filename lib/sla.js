'use strict';
var Q = require('q');
var dal = require('./dal.js');
var customError = require('./customError.js');
var designateMixingBridge = require('./designateMixingBridge.js');
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
 * Adds the caller channel and originated channel (if applicable) to the bridge.
 * @param {Object} client - the client (used for hanging up at the end).
 * @param {Object} channels - Array of channels to be added to the bridge.
 * @param {Object} bridge - Bridge that channels are to be added to.
 * @return {Q} Q promise object.
 */
function addChannelsToBridge(client, channels, bridge) {
  var defer = Q.defer();
  var extName = bridge.name;

  console.log('Adding channels to bridge %s', bridge.id);

  var addChannel = Q.denodeify(bridge.addChannel.bind(bridge));
  if (channels.length === 2) {
    addChannel({channel: [channels[0].id, channels[1].id]})
      .catch(function (err) {
        defer.reject(err);
      });
  } else {
    addChannel({channel: channels[0].id})
      .catch(function (err) {
        defer.reject(err);
      });
  }
  return defer.promise;
}
/**
 * Utility function for checking whether or not a call is in progress
 * @param {String} currentState - the current state of the SLA extension
 * @return {boolean} - whether or not the extension has a call in progress
 */
function callInProgress(currentState) {
  if (currentState === states.INUSE || currentState === states.BUSY ||
      currentState === states.RINGING) {
        return true;
      } else {
        return false;
      }
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
function originateIntoExtension(client, inbound, bridge) {

  var dialedChannels = [];
  var defer = Q.defer();

  var extName = bridge.name;
  var currentState = extsInUse[extName].currentState;
  if (!callInProgress(currentState)) {
    extsInUse[extName].currentTrunk = inbound.name;
    var stations = extsInUse[extName].stations;
    // The stations array is used for keeping up with the dialed channels
    // so that they can be hung up properly when certain event
    // conditionals are fired off.
    stations.forEach(function(station) {
      dialedChannels.push({endpoint: station, channel: client.Channel()});
    });

    dialedChannels.forEach(function (object) {
      var originate = Q.denodeify(object.channel.originate.bind(
      	object.channel));
      originate({endpoint: object.endpoint, app: 'sla',
      	appArgs: 'dialed',
      	timeout: extsInUse[extName].timeout})
      .catch(function (err) {
      	defer.reject(err);
      });

      updateState(client, extsInUse, extName, states.RINGING);

      object.channel.once('StasisStart', dialedStationEnteredStasis);
      object.channel.once('ChannelDestroyed', dialedStationHungup);
    });
    inbound.once('ChannelHangupRequest', inboundHungup);

  } else {
    // This will either redirect this channel towards a Hangup or a "backup
    // extension"
    inbound.continueInDialplan();

    defer.reject(new customError.CustomError('ExtensionOccupied',
    	'An inbound caller attempted to call into a busy extension'));
  }
  return defer.promise;

  /**
   * The function that gets called once dialed enters Stasis.
   *   Kills the other remaining stations and returns the line that picked up.
   * @param {Object} event - the information related to the StasisStart event
   * @param {Object} line - the line that has entered Stasis
   */
  function dialedStationEnteredStasis(event, line) {
    var answer = Q.denodeify(line.answer.bind(line));
    answer();

    var toKill = dialedChannels.filter(function (unanswered) {
      if (unanswered.channel.id === line.id) {
        unanswered.channel.removeAllListeners('ChannelDestroyed');
      }
      return unanswered.channel.id !== line.id;
    });
    toKill.forEach(function (unanswered) {
      unanswered.channel.removeListener('ChannelDestroyed',
        dialedStationHungup);

      var hangup = Q.denodeify(unanswered.channel.hangup.bind(
          unanswered.channel));
      hangup();

    });
    line.removeListener('ChannelDestroyed', dialedStationHungup);
    inbound.removeListener('ChannelHangupRequest', inboundHungup);
    extsInUse[extName].currentStations.push(line.name);
    updateState(client, extsInUse, extName, states.INUSE);

    defer.resolve(line);
  }

  /**
   * Utility function for cheking if all dialed channels have been hungup
   * @param {Array} dialed - the array of channels; the length is checked
   * @return {boolean} - whether or not the dialed array is empty
   */

  function allAreHungup(dialed) {
   return !(dialed.length);
  }

  /**
   * Utility function for finding what position a dialed channel is in dialed
   * @param {Object} channel - the channel object that is attempting to be found
   * @return {int} position - what position the channel is in the array
   *   (-1 if not found)
   */
  function findInDialed(channel) {
    var position = -1;
    dialedChannels.forEach(function(object, index) {
      if (channel.id === object.channel.id) {
        position = index;
      }
    });
    return position;
  }

  /**
   * Function that gets called when a dialed channel hangs up
   * @param {Object} event - the event object related to this hang up
   *   Determines what channel is to be removed from dialed.
   */
  function dialedStationHungup(event) {
    var index = findInDialed(event.channel);
    if (index !== -1) {
      dialedChannels.splice(index,1);
    } else {
      defer.reject(new customError.CustomError('BadRemoval','Failed to remove' +
           ' element in dialed.  Element not found.'));
    }
    if (allAreHungup(dialed)) {
      updateState(client, extsInUse, extName, states.IDLE);
      extsInUse[extName].removeTrunk(inbound.name);
      inbound.removeListener('ChannelHangupRequest', inboundHungup);
      defer.reject(new customError.CustomError('StationsHungup',
            'All stations on this shared extension hungup'));
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

    updateState(client, bridge.name, states.IDLE);
    extsInUse[extName].removeTrunk(inbound.name);
    defer.reject(new customError.CustomError('InboundHungup',
          'Inbound channel hungup'));
  }
}
/**
 * The function that starts originating an outbound call
 * @param {Object} client - the ARI client that has access to neede objects
 * @param {Object} outbound - the outbound channel object
 * @param {Object} bridge - the bridge used in this outbound call
 * @return {Object} - Q promise object
 */
function originateOutbound(client, outbound, bridge) {
  var toDial = '';
  var channelToDial;
  var defer = Q.defer();
  var extName = bridge.name;
  var currentState = extsInUse[extName].currentState;

  if (!callInProgress(currentState)) {
    var playback = client.Playback();
    outbound.play({media: 'sound:pls-entr-num-uwish2-call'}, playback);

    updateState(client, extsInUse, extName, states.BUSY);
    outbound.on('ChannelDtmfReceived', dtmfReceived);
    outbound.once('ChannelHangupRequest', outboundHungupEarly);
  } else {
    console.log('CALL IN PROGRESS');
    defer.resolve();
  }
  return defer.promise;
  /**
   * The function that gets called once the dialed channel enters Stasis.
   *   Makes the extension busy and clears eventListeners
   * @param {Object} event - the information related to the StasisStart event
   * @param {Object} line - the line that has entered Stasis
   */
  function dialedTrunkEnteredStasis(event, line) {
    updateState(client, extsInUse, extName, states.INUSE);
    outbound.removeListener('ChannelHangupRequest', outboundHungup);
    outbound.removeListener('ChannelDtmfReceived', dtmfReceived);
    extsInUse[extName].currentTrunk = line.name;
    var answer = Q.denodeify(line.answer.bind(line));
    answer();

    defer.resolve(line);
  }

  /**
   * Function that gets called when a dialed channel hangs up
   * @param {Object} event - the event object related to this hang up
   */
  function dialedTrunkHungup(event) {
    updateState(client, extsInUse, extName, states.IDLE);
    outbound.removeListener('ChannelHangupRequest', outboundHungup);
    outbound.removeListener('ChannelDtmfReceived', dtmfReceived);
    defer.reject(new customError.CustomError('DialedHungup',
      'Dialed channel hungup'));
  }
  /**
   * Function that gets called when the outbound caller hangs up with a
   * calling in progress
   * @param {Object} event - the event object related to this hang up
   * @param {line} line - the channel that hungup
   */
  function outboundHungup(event, line) {
    updateState(client, extsInUse, extName, states.IDLE);
    channelToDial.removeListener(
      'ChannelDestroyed', dialedTrunkHungup);
    var hangup = Q.denodeify(channelToDial.hangup.bind(
        channelToDial));
    hangup();
    extsInUse[extName].removeStation(outbound.name);
    defer.reject(new customError.CustomError('OutboundHungup',
          'Outbound channel hungup'));
  }

  /**
   * Function that gets called when the outbound channel enters the application
   *   but hangs up before specifying the channel to dial.
   *   Mainly there so that a nonexistant dialed channel doesn't get hung up.
   * @param {Object} event - the event object related to this hang up.
   */
  function outboundHungupEarly(event) {
    updateState(client, extsInUse, extName, states.IDLE);
    extsInUse[extName].removeStation(outbound.name);
    defer.reject(new customError.CustomError('EarlyOutboundHungup',
          'Outbound channel hungup before dialing'));
  }

  /**
   * Function that gets called when a DTMF digit is received from the outbound
   *   channel. Originates a channel to the specified extension at the trunk
   *   in the configuration file when the '#' key is pressed.
   * @param {Object} event - the event object related to this DTMF input.
   *   Contains the DTMF digit as well.
   * @param {Object} channel - the channel that sent this DTMF
   */
  function dtmfReceived(event, channel) {
    var digit = event.digit;
    switch (digit) {
      case '#':
        channelToDial = client.Channel();

        var originate = Q.denodeify(channelToDial.originate.bind(
              channelToDial));
        originate({endpoint: 'SIP/' + toDial + '@'  +
                   extsInUse[extName].trunks[0], app: 'sla',
                   appArgs: 'dialed',
                   callerId: extName,
                   timeout: extsInUse[extName].timeout})
          .catch(function(err) {
            defer.reject(err);
          });

        updateState(client, extsInUse, extName, states.RINGING);

        channelToDial.once('StasisStart', dialedTrunkEnteredStasis);
        channelToDial.once('ChannelDestroyed', dialedTrunkHungup);
        outbound.removeListener('ChannelHangupRequest', outboundHungupEarly);
        outbound.once('ChannelHangupRequest', outboundHungup);
        break;

      default:
        toDial += digit;
        break;
    }
  }
}

/**
 * Frees an extension from the array of extension in use
 * param {String} extensionName - the name of the extension to remove
 */
function freeExtension(extensionName) {
  delete extsInUse.extensionName;
}

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
var removeTrunk = function(channelName) {
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
      var answer = Q.denodeify(channel.answer.bind(channel));
      return answer();
    })
    .then(function() {
      return designateMixingBridge(client, extsInUse, extensionName, states);
    })
    .then(function (result) {
      bridge = result;

      if (!isStation) {
        return originateIntoExtension(client, channel, bridge);
      } else {
        extsInUse[extensionName].currentStations.push(channel.name);
        return originateOutbound(client, channel, bridge);
      }
    })
    .then(function (result) {
      channels.push(channel);
      if (result) {
        channels.push(result);
      }

      return addChannelsToBridge(client, channels, bridge);
    })
    .then(function() {
    	console.log('Freedom!');
        freeExtension(extensionName);
        return 'Extension ' + extensionName + ' freed!';
    })
    .catch(function (err) {
      if (err.name !== 'InboundHungup' && err.name !== 'OutboundHungup' &&
          err.name !== 'OutboundHungupEarly' &&
          err.name !== 'ExtensionOccupied') {
            var hangup = Q.denodeify(channel.hangup.bind(channel));
            hangup();
          }
      if (extsInUse[extensionName] && !extsInUse[extensionName].currentTrunk &&
          !extsInUse[extensionName].currentStations) {
            freeExtension(extensionName);
          }
      throw err;
    });
};
