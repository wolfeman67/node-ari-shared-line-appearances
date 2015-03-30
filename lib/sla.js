'use strict';
var Q = require('q');
var regexp = require('node-regexp');
var dal = require('./dal.js');
var customError = require('./customError.js');

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
 * Adds the caller channel and originated channel (if applicable) to the bridge.
 * @param {Object} client - the client (used for hanging up at the end).
 * @param {Object} channel - Incoming channel to be added to the bridge.
 * @param {Object} dialed - Created/dialed channel to be added as well
 * @param {Object} bridge - Bridge that channels are to be added to.
 * @param {Object} trunkData - the trunkData relevant to this extension
 * @return {Q} Q promise object.
 */
function addChannelsToBridge(client, channel, dialed, bridge, trunkData) {
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
  function channelEntered(event, object) {
    console.log('Channel %s has entered the bridge', object.channel.id);
  }
  bridge.on('ChannelEnteredBridge', channelEntered);
  function channelLeft(event, object) {
    console.log('Channel %s has left the bridge', object.channel.id);
    var isStation = false;
    trunkData.some(function(trunk) {
      trunk.stations.some(function(station) {
        var re = regexp().find(station).toRegExp();
        // First conditional is for regular SIP users like SIP/phone1
        if (re.test(object.channel.name)) {
          isStation = true;
          return true;
        } else {
          // Second conditional is for other SIP users that have a different
          // server like SIP/phone2@1234
          var nameDivided = object.channel.name.split('/');
          if (re.test(nameDivided[0] + '/' + object.channel.caller.number +
              '@' + nameDivided[1])) {
                isStation = true;
                return true;
              }
        }
        if (isStation) {
          trunk.clearUser();
          return true;
        }
      });
    });

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
        object.bridge.channels.forEach( function(ID) {
          var hangup = Q.denodeify(client.channels.hangup.bind
            (client.channels));
          hangup({channelId: ID})
            .catch(function (err) {
              err.name = 'HangupFailure';
              defer.reject(err);
            });
        });
      }
    }
    if (object.bridge.channels.length === 0) {
      defer.resolve(true);
      bridge.removeAllListeners('ChannelEnteredBridge');
      bridge.removeAllListeners('ChannelLeftBridge');
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
 * @param {Object} extension - the data structure that represents the extension,
 *   mainly used for telling whether or not an extension is busy or not
 * @return {Q} Q promise object.
 */
function originateInbound(client, inbound, bridge, extension) {
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
    extension.makeBusy();;
    defer.resolve(line);
  }
  /**
   * Utility function for cheking if all dialed channels have been hungup
   * @param {Array} dialed - the array of channels; the length is checked
   * @return {boolean} - whether or not the dialed array is empty
   */

  var allAreHungup = function(dialed) {
   return !dialed.length;
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
      defer.reject(new CustomError('BadRemoval','Failed to remove element in' +
            'dialed.  Element not found.'));
    }
    if (allAreHungup(dialed)) {
      inbound.removeListener('ChannelHangupRequest', inboundHungup);
      defer.resolve(originateInbound(client, inbound, bridge, trunkData));
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
    defer.resolve('Inbound channel hungup');
  }
  var defer = Q.defer();
  var dialed = [];
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
          object.channel.once('StasisStart', dialedEnteredStasis);
          object.channel.once('ChannelDestroyed', dialedChannelHungup);
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

function originateOutbound(client, outbound, bridge, extension, trunkData) {
  /**
   * The function that gets called once dialed enters Stasis.
   *   Kills the other remaining stations and returns the line that picked up.
   * @param {Object} event - the information related to the StasisStart event
   * @param {Object} line - the line that has entered Stasis
   */
  function dialedEnteredStasis(event, line) {
    outbound.removeListener('ChannelHangupRequest', outboundHungup);
    outbound.removeListener('ChannelDtmfReceived', dtmfReceived);
    var answer = Q.denodeify(line.answer.bind(line));
    answer();
    trunkToUse.setUser(line.name);
    defer.resolve(line);
  }
  
  /**
   * Function that gets called when a dialed channel hangs up
   * @param {Object} event - the event object related to this hang up
   *   Determines what channel is to be removed from dialed.
   */
  function dialedChannelHungup(event) {
      if (
      outbound.removeListener('ChannelHangupRequest', outboundHungup);
      outbound.removeListener('ChannelDtmfReceived', dtmfReceived);
      defer.reject(new CustomError('DialedHungup', 'Dialed channel hungup');
  }
  function outboundHungup(event, line) {
    channelToDial.removeListener(
      'ChannelDestroyed', dialedChannelHungup);
    var hangup = Q.denodeify(channelToDial.hangup.bind(
        channelToDial));
    hangup();
    defer.resolve('Outbound channel hungup');
  }
  
  function dialinSuccession(index) {
    if(index !== trunkData.length) {
      channelToDial = client.Channel();
      var originate = Q.denodeify(channelToDial.originate.bind(channelToDial));
      originate({endpoint: 'SIP/' + toDial + '@' + trunks[index], app: 'sla',
        appArgs: 'dialed',
        timeout: 10})
        .catch(function(err) {
          defer.reject(err);
        });
      channelToDial.once('StasisStart', dialedEnteredStasis);
      channelToDial.once('ChannelDestroyed', dialedChannelHungup);
      channelToDial.once('ChannelHangupRequest', outboundHungup);
    } else {
      defer.reject(new CustomError('ExtensionBusy', 'All extensions with this' +
            ' number are busy or invalid'));
    }
  }

  function dtmfReceived(event, channel) {
    /**
     * Function that gets called when the inbound channel hangs up.
     *   Hangs up all dialed channels. Defers confirmation that inbound has hung
     *   up.
     * @param {Object} event - the event object related to this hang up
     */
    var digit = event.digit;
    switch (digit) {
      case '#':
        if (!trunkSpecified) {
          channelToDial = client.Channel();
          var originate = Q.denodeify(channelToDial.originate.bind(
                channelToDial));
          originate({endpoint: 'SIP/' + toDial + '@'  +
            trunks[parseInt(trunkNum)], app: 'sla',
            appArgs: 'dialed',
            timeout: 10})
            .catch(function(err) {
              defer.reject(err);
            });
          channelToDial.once('StasisStart', dialedEnteredStasis);
          channelToDial.once('ChannelDestroyed', dialedChannelHungup);
          outbound.once('ChannelHangupRequest', outboundHungup);
        } else {
          dialInSuccession(0);
        }
      break;
    case '*':
      trunkSpecified = true;
      var trunkNum = 0;
    default:
      if (!trunkSpecified) {
        toDial += digit;
      } else {
        trunkNum += digit;
      }
    }
  }
  var trunkSpecified;
  var toDial = '';
  var callInProgress = false;
  var channelToDial;
  if (extension.busy) {
    callInProgress = true;
  }
  var defer = Q.defer();
  if (!callInProgress) {
    var playback = client.Playback();
    outbound.play({media: 'sound:pls-entr-num-uwish2-call'}, playback);
    outbound.on('ChannelDtmfReceived', dtmfReceived);
  } else {
    defer.resolve('Call in progress');
  }
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
function isStation (extension, channel) {
  return extension.getAllStations().then(function(stations) {
    var isStation = false;
    stations.some(function(station) {
      var re = regexp().find(station.endpoint).toRegExp();
      // First conditional is for regular SIP users like SIP/phone1
      if (re.test(channel.name)) {
        isStation = true;
        return true; 
      } else {
        // Second conditional is for other SIP users that have a different
        // server like SIP/phone2@1234
        var nameDivided = channel.name.split('/');
        if (re.test(nameDivided[0] + '/' + channel.caller.number + '@' +
            nameDivided[1])) {
              isStation = true;
              return true;
            }
      }
    });
    return Q.resolve(isStation);
  });
}

function getTrunkData (extension) {
  return sharedExtension.getAllTrunks();
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
module.exports = function(client, confFile, channel, extensionName) {
  return dal.getSharedExtension(confFile, extensionName)
    .then(function(extension) {
      return isInbound(extension, channel)
      .then(function (isStation) {
      return getTrunkData(confFile, extension)
        .then(function(trunks) {
          var answer = Q.denodeify(channel.answer.bind(channel));
          return answer()
            .then(function() {
              return designateMixingBridge(client, extension);
            }).then(function (bridge) {
              if (!isStation) {
                return originateInbound(client, channel, bridge, trunks)
                  .then(function (dialed) {
                      return addChannelsToBridge(client, channel, dialed,
                        bridge, trunks).then(function(toFree) {
                          if (toFree === true) {
                            dal.clearSharedExtension(extension);
                            return Q.resolve('Application completed!');
                          }
                        });
                  });
              } else {
                return originateOutbound(client, channel, bridge, extension,
                    trunks)
                  .then(function (dialed) {
                      return addChannelsToBridge(client, channel, dialed,
                        bridge, trunks).then(function(toFree) {
                          if (toFree === true) {
                            dal.clearSharedExtension(extension);
                            return Q.resolve('Application completed!');
                          }
                        });
                  })
                  .catch(function (err) {
                      if (err.name === 'ExtensionInUse') {
                        return addChannelsToBridge(client, channel, null, bridge,
                          trunks).then(function(toFree) {
                            if (toFree === true) {
                              dal.clearSharedExtension(extension);
                              return Q.resolve('Application completed!');
                            }
                          });
                      }
                  });
              }
            });
      })
    .catch(function (err) {
      if (err.name !== 'InboundHungup' ||
        err.name !== 'OutboundHungup') {
          var hangup = Q.denodeify(channel.hangup.bind(channel));
          hangup();
      }
      return Q.reject(err);
    });
    });
    })
    .catch(function(invalid) {
      if (invalid === 'Invalid specified extension: ' + extension) {
        return Q.reject(new CustomError('InvalidSpecification', invalid));
      } else {
        return Q.reject(new CustomError('InvalidConfiguration',
            invalid.message));
      }
    });
};
