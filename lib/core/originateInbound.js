var Q = require('q');
var customError = require('./customError.js');
var getState = require('./getState.js');
var updateState = require('./updateState.js');
var states = require('./states.js');

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
function originateInbound(client, channel, bridge, extension) {

  var dialed = [];
  var defer = Q.defer();

  getState(client, bridge.name).then(function(currentState) {

    if (currentState !== states.INUSE && currentState !== states.BUSY &&
        currentState !== states.RINGING) {
      var stations = extension.stations;
      if (stations.length) {
        updateState(client, bridge.name, states.RINGING);
        stations.forEach(function(station) {
          var channel = client.Channel();
          dialed.push(channel);
          var originate = Q.denodeify(channel.originate.bind(channel));
          originate({endpoint: station, app: 'sla',
            appArgs: 'dialed', timeout: 10})
            .catch(function (err) {
              defer.reject(err);
            });
          channel.once('StasisStart', onStationEnteredStasis);
          channel.once('ChannelDestroyed', onStationHangup);
        });
        inbound.once('ChannelHangupRequest', onInboundHangup);
      } else {
        defer.reject(new customError.CustomError('NoStations',
              'No stations in this shared extension.'));
      }
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
  function onStationEnteredStasis(event, line) {
    var answer = Q.denodeify(line.answer.bind(line));
    answer();

    dialed.forEach(function (channel) {
      if (channel.id !== line.id) {
        var hangup = Q.denodeify(channel.hangup.bind(
            channel));
        hangup();
      }
      channel.removeAllListeners('ChannelDestroyed');
      return channel.id !== line.id;
    });
    inbound.removeAllListeners('ChannelHangupRequest');

    updateState(client, bridge.name, states.INUSE);
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
    dialed.forEach(function(dialedChannel, index) {
      if (channel.id === dialedChannel.id) {
        position = index;
      }
    });
    return position;
  }

  /**
   * Function that gets called when a dialed station hangs up
   * @param {Object} event - the event object related to this hang up
   *   Determines what channel is to be removed from dialed.
   */
  function onStationHangup(event) {
    var index = findInDialed(event.channel);
    if (index !== -1) {
      dialed.splice(index, 1);
    } else {
      defer.reject(new customError.CustomError('BadRemoval','Failed to remove' +
           ' element in dialed. Element not found.'));
    }
    if (allAreHungup(dialed)) {
      updateState(client, bridge.name, states.IDLE);
      inbound.removeListener('ChannelHangupRequest', onInboundHangup);
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
  function onInboundHangup(event, line) {
    dialed.forEach(function (unanswered) {
      unanswered.removeListener(
        'ChannelDestroyed', onStationHangup);

      var hangup = Q.denodeify(unanswered.hangup.bind(
          unanswered));
      hangup();
    });

    updateState(client, bridge.name, states.IDLE);
    defer.reject(new customError.CustomError('InboundHungup',
          'Inbound channel hungup'));
  }
}
module.exports = originateInbound;
