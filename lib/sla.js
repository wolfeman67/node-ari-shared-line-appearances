'use strict';
var Q = require('q');
var dal = require('./dal.js');
var customError = require('./customError.js');
var regexp = require('node-regexp');

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
 * @param {Object} channel - Incoming channel to be added to the bridge.
 * @param {Object} dialed - Created/dialed channel to be added as well
 * @param {Object} bridge - Bridge that channels are to be added to.
 * @param {Object} trunkData - the trunkData relevant to this extension
 * @return {Q} Q promise object.
 */
function addChannelsToBridge(channel, dialed, bridge, trunkData) {
  // Resets listeners, so that redundant events aren't accepted.
  bridge.removeAllListners();
  var defer = Q.defer();
  console.log('Adding channels to bridge %s', bridge.id);
  var addChannel = Q.denodeify(bridge.addChannel.bind(bridge));
  addChannel({channel: inbound.id})
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
      if (trunk.stations.indexOf(object.channel.name) !== -1) {
        isStation = true;
        return true;
      }
    });

    if (isStation) {
      if(object.bridge.channels.length === 1) {
        var hangupOutsider = Q.denodeify(object.bridge.channels[0].hangup.bind
            (object.bridge.channels[0]));
        hangupOutsider()
          .catch(function (err) {
            err.name = 'HangupFailure';
            defer.reject(err);
          });
      }
    } else {
      if (object.bridge.length.channels) {
        console.log('Hanging up station channel/s');
        object.bridge.channels.forEach(function(channel) {
          var hangup = Q.denodeify(channel.hangup.bind(channel));
          hangup()
            .catch(function (err) {
              err.name = 'HangupFailure';
             defer.reject(err);
            });
          });
      }
    }
    if (object.bridge.length.channels === 0) {
      trunkData.forEach(function (trunk) {
        if (trunk.user === dialed.name) {
          trunk.clearUser();
        }
      });
      var readyToClearExt = true;
      trunkData.some(function (trunk) {
        if (trunk.user) {
          readyToClearExt = false;
        }
      });
      defer.resolve(readyToClearExt);
      object.bridge.removeAllListeners();
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
function originateInbound(client, inbound, bridge, trunkData) {
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
    trunkToUse.setUser(line.name);
    trunkData.forEach( function(trunk) {
      trunk.makeBusy();
    });
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
      trunkToUse.makeBusy();
      inbound.removeListener('ChannelHangupRequest', inboundHungup);
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
    defer.reject(new customError.CustomError('InboundHungup',
          'Inbound channel hungup'));
  }
  var trunkToUse;
  trunkData.some(function(trunk) {
    if (!trunk.user && !trunk.busy) {
      trunkToUse = trunk;
      return true;
    }
  });
  if (!trunkToUse) {
    trunkData.forEach(function (trunk) {
      trunk.makeAvailable();
    });
    return Q.reject(new CustomError('ExtensionBusy', 'Extension ' +
         bridge.name + ' is busy.'));
  }
  var defer = Q.defer();
  var dialed = [];
  trunkToUse.getAllStations()
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
        defer.reject(new customError.CustomError('NoStations',
              'No stations in this trunk.'));
      }
    });
  return defer.promise;
}

function originateOutbound(client, outbound, bridge, trunkData) {
  /**
   * The function that gets called once dialed enters Stasis.
   *   Kills the other remaining stations and returns the line that picked up.
   * @param {Object} event - the information related to the StasisStart event
   * @param {Object} line - the line that has entered Stasis
   */
  function dialedEnteredStasis(event, line) {
    var answer = Q.denodeify(line.answer.bind(line));
    answer();
    trunkToUse.setUser(line.name);
    trunkData.forEach( function(trunk) {
      trunk.makeBusy();
    });
    defer.resolve(line);
  }
  
  /**
   * Function that gets called when a dialed channel hangs up
   * @param {Object} event - the event object related to this hang up
   *   Determines what channel is to be removed from dialed.
   */
  function dialedChannelHungup(event) {
      outbound.removeListener('ChannelHangupRequest', outboundHungup);
      outbound.removeListener('ChannelDtmfReceived', dtmfReceived);
      defer.resolve('Dialed channel hungup');
  }
    function outboundHungup(event, line) {
      channelToDial.removeListener(
        'ChannelDestroyed', dialedChannelHungup);
      var hangup = Q.denodeify(channelToDial.hangup.bind(
          channelToDial));
      hangup();
      defer.resolve('Outbound channel hungup');
    }
  

  function dtmfReceived(event, channel) {
    /**
     * Function that gets called when the inbound channel hangs up.
     *   Hangs up all dialed channels. Defers confirmation that inbound has hung
     *   up.
     * @param {Object} event - the event object related to this hang up
     */
    var channelToDial;
    var digit = event.digit;
    switch (digit) {
      case '#':
        console.log('AMAZON');
        var endpoint = channel.name.split('-')[0];
        channelToDial = client.Channel();
        var originate = Q.denodeify(channelToDial.originate.bind(
              channelToDial));
        console.log(endpoint);
        originate({endpoint: endpoint, extension: toDial, app: 'sla',
          appArgs: 'dialed',
          timeout: 10})
          .catch(function(err) {
            defer.reject(err);
          });
        channelToDial.once('StasisStart', dialedEnteredStasis);
        channelToDial.once('ChannelDestroyed', dialedChannelHungup);
        outbound.once('ChannelHangupRequest', outboundHungup);
      break;
    default:
      toDial += digit;
    }
  }
  var trunkToUse;
  var toDial = '';
  var callInProgress = false;
  trunkData.some(function(trunk) {
    if(trunk.user) {
      callInProgress = true;
    }
  });

  trunkData.some(function(trunk) {
    if (!trunk.user && !trunk.busy) {
      trunkToUse = trunk;
      return true;
    }
  });
  if (!trunkToUse) {
    trunkData.forEach(function (trunk) {
      trunk.makeAvailable();
    });
    return Q.reject(new CustomError('ExtensionBusy', 'Extension ' +
         bridge.name + ' is busy.'));
  }
  var defer = Q.defer();
  if (!callInProgress) {
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
function isInbound (configurationFile, extension, channel) {
  return dal.getSharedExtension(configurationFile, extension)
    .then(function(sharedExtension) {
      return sharedExtension.getAllStations().then(function(stations) {
        var isStation = false;
        stations.forEach(function(station) {
          var re = regexp().find(station.endpoint).toRegExp();
          // First conditional is for regular SIP users like SIP/phone1
          if (re.test(channel.name)) {
            isStation = true; 
          } else {
            // Second conditional is for other SIP users that have a different
            // server like SIP/phone2@1234
            var nameDivided = channel.name.split('/');
            if (re.test(nameDivided[0] + '/' + channel.caller.number + '@' +
                nameDivided[1])) {
                  isStation = true;
                }
          }
        });
        return Q.resolve(!isStation);
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
}

function getTrunkData (configurationFile, extension) {
  return dal.getSharedExtension(configurationFile, extension)
    .then(function(sharedExtension) {
      return sharedExtension.getAllTrunks().then(function(trunks) {
      return Q.resolve(trunks);
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
module.exports = function(client, confFile, channel, extension, dal) {
  return isInbound(confFile, extension, channel, dal)
    .then(function (inbound) {
      console.log(inbound);
      if (inbound) {
        return inboundDialing(client, confFile, channel, extension, dal);
      } else {
        console.log('You suck');
      }
    });
};
function inboundDialing(client, confFile, inbound, extension, dal) {
  console.log('MANKEY');
  return getTrunkData(confFile, extension, dal)
    .then(function(trunks) {
      var answer = Q.denodeify(inbound.answer.bind(inbound));
      return answer()
        .then(function() {
          return designateMixingBridge(client, extension);
        }).then(function (bridge) {
          return originateChannel(client, inbound, bridge, trunks, dal)
            .then(function (dialed) {
              return addChannelsToBridge(inbound, dialed, bridge);
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
}
