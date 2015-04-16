'use strict';
var Q = require('q');
var dal = require('./dal.js');
var customError = require('./customError.js');
var regexp = require('node-regexp');
var extsInUse = {};

var hold = 'ONHOLD';
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
 * Updates the state of the shared extension.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {String} name - name of the shared extension to update.
 * @param {String} state - state to update the shared extension to.
 */
function updateState(client, name, state) {
  extsInUse[name].currentState = state;
  var deviceState = Q.denodeify(client.deviceStates.update.bind(client));
  return deviceState({deviceName: 'Stasis:' + name, deviceState: state});
}

/**
 * Adds the caller channel and originated channel (if applicable) to the bridge.
 * @param {Object} client - the client (used for hanging up at the end).
 * @param {Object} channels - Array of channels to be added to the bridge.
 * @param {Object} bridge - Bridge that channels are to be added to.
 * @return {Q} Q promise object.
 */
function addChannelsToBridge(client, channels, bridge) {
  var holdPressed = false;
  var extName = bridge.name;
  // The only way that the channel length will be 1 is if the outside user is
  // still inside of the shared extension waiting for others to answer.
  if (bridge.channels.length === 1) {
    bridge.stopMoh();
    updateState(client, bridge.name, inUse);
  }

  // Resets listeners, so that redundant events aren't accepted.
  bridge.removeAllListeners('ChannelEnteredBridge');
  bridge.removeAllListeners('ChannelLeftBridge');
  var defer = Q.defer();

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
  isStation(extName, channels[0]).then(function(isStation) {
    if (isStation) {
      channel.on('ChannelHold', channelHold);
    }
  });

  bridge.on('ChannelEnteredBridge', channelEntered);
  bridge.on('ChannelLeftBridge', channelLeft);
  return defer.promise;

  /**
   * Function that displays a helpful message when a channel enters a bridge
   * @param {Object} event - the event related to this bridge entering
   * @param {Object} object - contains the bridge and channel in question
   */
  function channelEntered(event, object) {
    console.log('Channel %s has entered the bridge', object.channel.id);

  }

  /**
   * Function that is utilized when a channel leaves the bridge
   * @param {Object} event - the event related to the bridge leaving
   * @param {Object} object - contains the bridge and channel in question
   */
  function channelLeft(event, object) {
    isStation(extName, object.channel).then(function (isStation) {
      console.log(isStation);
      if (isStation) {
        extsInUse[extName].removeStation(object.channel.name);
        if (object.bridge.channels.length === 1) {
          // If a station presses their hold button
          if (holdPressed) {
            object.bridge.startMoh();
            updateState(client, extName, hold);
          } else {
            var hangupOutsider = Q.denodeify(client.channels.hangup.bind
              (client.channels));
            hangupOutsider({channelId: object.bridge.channels[0]})
              .catch(function(err) {
                err.name = 'HangupFailure';
                defer.reject(err);
              });
          }
        }

      } else {
        console.log('TRUNK HUNG UP');
        extsInUse[extName].removeTrunk(object.channel.name);
        console.log(object.bridge.channels.length);
        if (object.bridge.channels.length) {
          console.log('Hanging up station channel/s');

          var hangupArray = [];
          extsInUse[extName].currentStations = [];
          object.bridge.channels.forEach( function(ID) {
            var hangup = Q.denodeify(client.channels.hangup.bind(
                client.channels));
            hangupArray.push(hangup({channelId: ID}));
          });
          return Q.all(hangupArray);
        }
      }

      if (object.bridge.channels.length === 0) {
        console.log('NO MORE TEARS');
        defer.resolve();
        updateState(client, bridge.name, idle);
        bridge.removeAllListeners('ChannelEnteredBridge');
        bridge.removeAllListeners('ChannelLeftBridge');
      }
    });
  }

  /**
   * Function that gets called when a station presses their hold key.
   *   Hangs up channel and determines that a hold was called for in this
   *   extension.
   * @param {Object} event - the event related to the hold intercept
   * @param {Object} channel - the channel that pressed its hold key
   */
  function channelHold(event, channel) {
    channel.removeAllListeners('ChannelHold');
    holdPressed = true;
    console.log('Station ' + channel.id + ' pressed its hold key');
    var hangupHold = Q.denodeify(channel.hangup.bind(channel));
    hangupHold();
  }
}
/**
 * Utility function for checking whether or not a call is in progress
 * @param {String} currentState - the current state of the SLA extension
 * @return {boolean} - whether or not the extension has a call in progress
 */
function callInProgress(currentState) {
  if (currentState === inUse || currentState === busy ||
      currentState === ringing || currentState === hold) {
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
    extsInUse[extName].getAllStations()
      .then(function (stations) {
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

          updateState(client, extName, ringing);

          object.channel.once('StasisStart', dialedEnteredStasis);
          object.channel.once('ChannelDestroyed', dialedChannelHungup);
        });
       inbound.once('ChannelHangupRequest', inboundHungup);

    });
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
  function dialedEnteredStasis(event, line) {
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
        dialedChannelHungup);

      var hangup = Q.denodeify(unanswered.channel.hangup.bind(
          unanswered.channel));
      hangup();

    });
    line.removeListener('ChannelDestroyed', dialedChannelHungup);
    inbound.removeListener('ChannelHangupRequest', inboundHungup);
    extsInUse[extName].currentStations.push(line.name);
    updateState(client, extName, inUse);

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
  function dialedChannelHungup(event) {
    var index = findInDialed(event.channel);
    if (index !== -1) {
      dialedChannels.splice(index,1);
    } else {
      defer.reject(new customError.CustomError('BadRemoval','Failed to remove' +
           ' element in dialed.  Element not found.'));
    }
    if (allAreHungup(dialed)) {
      updateState(client, extName, idle);
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

    updateState(client, bridge.name, idle);
    extsInUse[extName].removeTrunk(inbound.name);
    defer.reject(new customError.CustomError('InboundHungup',
          'Inbound channel hungup'));
  }
}
/**
 * The function that starts originating an outbound call
 * @param {Object} client - the ARI client that has access to neede objects
 * @param {Array} trunkData - the array of trunk data related to the extension
 * @param {Object} outbound - the outbound channel object
 * @param {Object} bridge - the bridge used in this outbound call
 */
function originateOutbound(client, outbound, bridge) {
  var toDial = '';
  var channelToDial;
  var defer = Q.defer();
  var extName = bridge.name;
  var currentState = extsInUse[extName].currentState;
  console.log(currentState);
  if (!callInProgress(currentState)) {
    var playback = client.Playback();
    outbound.play({media: 'sound:pls-entr-num-uwish2-call'}, playback);

    updateState(client, extName, busy);
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
  function dialedEnteredStasis(event, line) {
    updateState(client, extName, inUse);
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
  function dialedChannelHungup(event) {
    updateState(client, extName, idle);
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
    updateState(client, extName, idle);
    channelToDial.removeListener(
      'ChannelDestroyed', dialedChannelHungup);
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
    updateState(client, extName, idle);
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

        updateState(client, extName, ringing);

        channelToDial.once('StasisStart', dialedEnteredStasis);
        channelToDial.once('ChannelDestroyed', dialedChannelHungup);
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
 * Utility function for checking if a channel is a member of an extension
 * @param {String} extensionName - the name of the extension to check
 * @param {String} channel - the channel in question
 * @return {Q} - Q promise object
 */
function isStation (extensionName, channel) {
  return extsInUse[extensionName].getAllStations()
    .then(function(stations) {
    var isStation = false;
    for (var index = 0; index < stations.length; index++) {
      var station = stations[index];
      var re = regexp().find(station).toRegExp();

      // First conditional is for regular SIP users like SIP/phone1
      if (re.test(channel.name)) {
        isStation = true;
        break;
      } else {

        // Second conditional is for other SIP users that have a different
        // server like SIP/phone2@1234
        var nameDivided = channel.name.split('/');
        if (re.test(nameDivided[0] + '/' + channel.caller.number + '@' +
            nameDivided[1])) {
              isStation = true;
              break;
            }
      }
    }
    return isStation;
  });
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
        extsInUse[extensionName].currentState = 'NOT_INUSE';
      }
      return isStation(extensionName, channel);
    })
    .then(function(result) {
      var isStation = result;
      return isStation;
    })
}

/**
 * Removes a trunk from the list of current trunks of this sharedExtension
 * @param {String} channelName - the name of the channel
 */
var removeTrunk = function(channelName) {
  console.log('YES');
  this.currentTrunk = null;
  console.log('NO');
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
      return designateMixingBridge(client, extensionName);
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
        freeExtension(extensionName);
        return 'Extension ' + extensionName + ' freed!';
    })
    .catch(function (err) {
      console.log(err);

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
