'use strict';
var Q = require('q');
var dal = require('./dal.js');
var customError = require('./customError.js');
var regexp = require('node-regexp');

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
  var deviceState = Q.denodeify(client.deviceStates.update.bind(client));
  return deviceState({deviceName: 'Stasis:' + name, deviceState: state});
}

/**
 * Accesses the current state of the shared extension.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.  Houses the device states
 * @param {String} name - name of the shared extension to access.
 * @return {String} - the current device state of this extension
 */
function getState(client, name) {
  var getDeviceState = Q.denodeify(client.deviceStates.get.bind(client
        .deviceStates));
  return getDeviceState({deviceName: 'Stasis:' + name}).then(function (ds) {
    return ds.state;
  });
}

/**
 * Adds the caller channel and originated channel (if applicable) to the bridge.
 * @param {Object} client - the client (used for hanging up at the end).
 * @param {Object} channel - Incoming channel to be added to the bridge.
 * @param {Object} dialed - Created/dialed channel to be added as well
 * @param {Object} bridge - Bridge that channels are to be added to.
 * @param {Object} extension - the object data related to this sharedExtension
 * @return {Q} Q promise object.
 */
function addChannelsToBridge(client, channel, dialed, bridge, extension) {
  // Resets listeners, so that redundant events aren't accepted.
  bridge.removeAllListeners('ChannelEnteredBridge');
  bridge.removeAllListeners('ChannelLeftBridge');
  var defer = Q.defer();

  console.log('Adding channels to bridge %s', bridge.id);
  var addChannel = Q.denodeify(bridge.addChannel.bind(bridge));
  addChannel({channel: channel.id})
    .catch(function (err) {
      defer.reject(err);
    });
  if (dialed) {
    addChannel({channel: dialed.id})
      .catch(function (err) {
        defer.reject(err);
      });
  }
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
   * Function that is utilized when a channel leaves the bridge.
   *   If the channel is a non-station channel, then hangs up remaining
   *   channels.  If the channel is a station, checks if the only non-station
   *   channel is the only left, and then hangs up that non-station channel.
   * @param {Object} event - the event related to the bridge leaving
   * @param {Object} object - contains the bridge and channel in question
   */
  function channelLeft(event, object) {
    isStation(extension, object.channel).then(function (isStation) {
      if (isStation) {

        if (object.bridge.channels.length === 1) {
          var hangupOutsider = Q.denodeify(client.channels.hangup.bind
              (client.channels));
          hangupOutsider({channelId: object.bridge.channels[0]})
            .catch(function (err) {
              err.name = 'HangupFailure';
              defer.reject(err);
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
        defer.resolve();
        updateState(client, bridge.name, idle);
        bridge.removeAllListeners('ChannelEnteredBridge');
        bridge.removeAllListeners('ChannelLeftBridge');
      }
    });
  }
}

/**
 * Originates a channel to a specified endpoint and places it in the Stasis app.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {Object} inbound- the inbound channel
 * @param {Object} bridge - Object that defines the bridge to be passed to
 *   addChannelsToBridge().
 * @param {Object} extension - the data structure that represents the extension,
 *   mainly used for telling whether or not an extension is busy or not
 * @return {Q} Q promise object.
 */
function originateInbound(client, inbound, bridge, extension) {

  var dialed = [];
  var defer = Q.defer();

  getState(client, bridge.name).then(function(currentState) {

    if (currentState !== inUse && currentState !== busy &&
        currentState !== ringing) {
      extension.getAllStations()
        .then(function (stations) {

          if (stations.length) {
            stations.forEach(function(station) {
              dialed.push({endpoint: station, channel: client.Channel()});
            });

            dialed.forEach(function (object) {
              var originate = Q.denodeify(object.channel.originate.bind(
                  object.channel));
              originate({endpoint: object.endpoint, app: 'sla',
                  appArgs: 'dialed', timeout: 10})
                .catch(function (err) {
                  defer.reject(err);
                });

              updateState(client, bridge.name, ringing);

              object.channel.once('StasisStart', dialedEnteredStasis);
              object.channel.once('ChannelDestroyed', dialedChannelHungup);
            });
           inbound.once('ChannelHangupRequest', inboundHungup);
          } else {
            defer.reject(new customError.CustomError('NoStations',
                  'No stations in this shared extension.'));
          }
        });
    } else {
      // This will either redirect this channel towards a Hangup or a "backup
      // extension"
      inbound.continueInDialplan();

      defer.reject(new customError.CustomError('ExtensionOccupied',
            'An inbound caller attempted to call into a busy extension'));
    }
  });
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

    var toKill = dialed.filter(function (unanswered) {
      return unanswered.channel.id !== line.id;
    });
    toKill.forEach(function (unanswered) {
      unanswered.channel.removeListener('ChannelDestroyed',
        dialedChannelHungup);
      var hangup = Q.denodeify(unanswered.channel.hangup.bind(
          unanswered.channel));
      hangup();
    });

    updateState(client, bridge.name, inUse);
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
    dialed.forEach(function(object, index) {
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
      dialed.splice(index,1);
    } else {
      defer.reject(new customError.CustomError('BadRemoval','Failed to remove' +
           ' element in dialed.  Element not found.'));
    }
    if (allAreHungup(dialed)) {
      updateState(client, bridge.name, idle);
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
function originateOutbound(client, trunkData, outbound, bridge) {
  var toDial = '';
  var callInProgress = false;
  var channelToDial;
  var defer = Q.defer();

  getState(client, bridge.name).then(function (currentState) {
    if (currentState === inUse || currentState === ringing ||
      currentState === busy) {
      callInProgress = true;
    }

    if (!trunkData[0]) {
      defer.reject(new customError.CustomError('NoTrunks', 'There are no ' +
         'trunks with which to outbound dial'));
    } else if (!callInProgress) {
      var playback = client.Playback();
      outbound.play({media: 'sound:pls-entr-num-uwish2-call'}, playback);

      updateState(client, bridge.name, busy);
      outbound.on('ChannelDtmfReceived', dtmfReceived);
      outbound.once('ChannelHangupRequest', outboundHungupEarly);
    } else {
      console.log('CALL IN PROGRESS');
      defer.resolve();
    }
  });
  return defer.promise;
  /**
   * The function that gets called once the dialed channel enters Stasis.
   *   Makes the extension busy and clears eventListeners
   * @param {Object} event - the information related to the StasisStart event
   * @param {Object} line - the line that has entered Stasis
   */
  function dialedEnteredStasis(event, line) {
    updateState(client, bridge.name, inUse);
    outbound.removeListener('ChannelHangupRequest', outboundHungup);
    outbound.removeListener('ChannelDtmfReceived', dtmfReceived);
    var answer = Q.denodeify(line.answer.bind(line));
    answer();
    defer.resolve(line);
  }
  
  /**
   * Function that gets called when a dialed channel hangs up
   * @param {Object} event - the event object related to this hang up
   */
  function dialedChannelHungup(event) {
    updateState(client, bridge.name, idle);
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
    updateState(client, bridge.name, idle);
    channelToDial.removeListener(
      'ChannelDestroyed', dialedChannelHungup);
    var hangup = Q.denodeify(channelToDial.hangup.bind(
        channelToDial));
    hangup();
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
    updateState(client, bridge.name, idle);
    defer.reject(new customError.CustomError('EarlyOutboundHungup',
          'Outbound channel hungup before dialing'));
  }
  
  /**
   * Function that gets called when a DTMF digit is received from the outbound
   *   channel.  Originates a channel to the specified extension at the trunk
   *   in the configuration file when the '#' key is pressed
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
                   trunkData[0], app: 'sla',
                   appArgs: 'dialed',
                   timeout: 10})
          .catch(function(err) {
            defer.reject(err);
          });

        updateState(client, bridge.name, ringing);

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
 * @param {String} extension - the extension in question
 * @param {String} channel - the channel in question
 * @return {Q} - Q promise object
 */
function isStation (extension, channel) {
  return extension.getAllStations().then(function(stations) {
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
 * Returns the trunkData related to the extension in question
 * @param {Object} extension - the extension object which has both the stations
 *   and trunks
 * @return {Array} - the array of trunk endpoint strings
 */
function getTrunkData (extension) {
  return extension.getAllTrunks();
}

/**
 * Returns all relevant data for the extension to be used in module.exports
 * @param {string} confFile - the configuration path and file name
 * @param {Object} channel - the inbound or outbound channel
 * @param {string} extensionName - the name of the extension to access
 */
function getData(confFile, channel, extensionName) {
  var data = {};
  return dal.getSharedExtension(confFile, extensionName)
    .then(function(result) {
      data.extension = result;
      return isStation(data.extension, channel);
    })
    .then(function(result) {
      data.isStation = result;
      return getTrunkData(data.extension);
    })
    .then(function(result) {
      data.trunks = result;
      return data;
    });
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
  var data;
  var bridge;
  var dialed;

  return getData(confFile, channel, extensionName)
    .then(function(result) {
      data = result;
      var answer = Q.denodeify(channel.answer.bind(channel));
      return answer();
    })
    .then(function() {
      return designateMixingBridge(client, extensionName);
    })
    .then(function (result) {
      bridge = result;

      if (!data.isStation) {
        return originateInbound(client, channel, bridge, data.extension);
      } else {
        return originateOutbound(client, data.trunks, channel, bridge);
      }
    })
    .then(function (result) {
      dialed = result;

      return addChannelsToBridge(client, channel, dialed, bridge,
                                 data.extension);
    })
    .then(function() {
        return 'Extension'+ extensionName + 'freed!';
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
