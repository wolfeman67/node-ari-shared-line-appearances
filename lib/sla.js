'use strict';
var Q = require('q');

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
 * @return {Q} Q promise object.
 */
function originateChannel(client, inbound, bridge) {
  var defer = Q.defer();
  var dialed = [client.Channel(), client.Channel()];
  var originate = [];
  var numToHangup = dialed.length;
  var station = ['SIP/phone1', 'SIP/phone2'];
  dialed.forEach(function (channel, index, dialed) {
    originate.push(Q.denodeify(dialed[index].originate.bind(dialed[index])));
    originate[index]({endpoint: station[index], app: 'sla', appArgs: 'dialed',
        timeout: 10})
      .catch(function (err) {
        err.name = 'originateFailure';
        defer.reject(err);
      });
    dialed[index].once('StasisStart', function(event, line) {
      var answer = Q.denodeify(line.answer.bind(line));
      answer();
      var toKill = dialed.filter(function (unanswered) {
        return unanswered.id !== line.id;
      });
      toKill.forEach(function (unanswered) {
        var hangup = Q.denodeify(unanswered.hangup.bind(unanswered));
        hangup();
      });
      defer.resolve(line);
    });
    inbound.once('ChannelHangupRequest', function(event, line) {
      defer.resolve();
      dialed.forEach(function (unanswered) {
        var hangup = Q.denodeify(unanswered.hangup.bind(unanswered));
        hangup();
      });
    });
    dialed[index].once('ChannelDestroyed', function(event) {
      numToHangup -= 1;
      if(numToHangup === 0) {
        var hangup = Q.denodeify(inbound.hangup.bind(inbound));
        hangup();
        defer.resolve();
      }
    });
  });
  return defer.promise;
}

/** 
 * Simple utility function for checking if the bridgeName is numerical
 * @param {String} bridgeName - the name of the bridge to be created/used
 * @return {boolean} whether or not the bridgeName is numerical
 */
function checkIfNum(string) {
  if(!isNaN(parseInt(string))) {
    return true;
  }
  else {
    return false;
  }
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
 * @param {String} bridgeName - the name of the bridge to be used/created
 * @return {Q} Q promise object.
 */
module.exports = function(client, inbound, bridgeName) {
  //This specifies what bridge number to use for SLA
  if(checkIfNum(bridgeName)) {
    var answer = Q.denodeify(inbound.answer.bind(inbound));
    return answer()
      .then(function() {
        return designateMixingBridge(client, bridgeName);
      }).then(function (bridge) {
        return originateChannel(client, inbound, bridge)
          .then(function (dialed) {
            // If dialed is an actual channel, it will not be a string
            if (typeof dialed !== 'string') {
              return addChannelsToBridge(inbound, dialed, bridge);
            }
            else {
              var hangup = Q.denodeify(inbound.hangup.bind(inbound));
              hangup();
              throw new CustomError('EarlyHangup',
                dialed);
            }
          });
      });
  }
  else {
    var hangup = Q.denodeify(inbound.hangup.bind(inbound));
    hangup();
    return Q.reject(new CustomError('SLASpecficationError',
          'Not a numeric SLA specification: ' + bridgeName));
  }
};
