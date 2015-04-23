var Q = require('q');
var updateState = require('./updateState.js');
var callInProgress = require('./callInProgress.js');
var customError = require('./customError.js');
/**
 * Originates a channel to a specified endpoint and places it in the Stasis app.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {Object} extsInUse - the current extensions in use and their
 *   properties
 * @param {Object} inbound- the inbound channel
 * @param {Object} bridge - Object that defines the bridge to be passed to
 *   addChannelsToBridge().
 * @param {Object} states - the list of possible states
 * @return {Q} Q promise object.
 */
function originateIntoExtension(client, extsInUse, inbound, bridge, states) {

  var dialedChannels = [];
  var defer = Q.defer();

  var extName = bridge.name;
  var currentState = extsInUse[extName].currentState;
  if (!callInProgress(currentState, states)) {
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
    if (allAreHungup(dialedChannels)) {
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
module.exports = originateIntoExtension;