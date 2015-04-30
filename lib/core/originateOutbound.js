var Q = require('q');
var customError = require('./customError.js');
var getState = require('./getState.js');
var updateState = require('./updateState.js');
var states = require('./states.js');
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
    if (currentState === states.INUSE || currentState === states.RINGING ||
      currentState === states.BUSY) {
      callInProgress = true;
    }

    if (!trunkData[0]) {
      defer.reject(new customError.CustomError('NoTrunks', 'There are no ' +
         'trunks with which to outbound dial'));
    } else if (!callInProgress) {
      var playback = client.Playback();
      outbound.play({media: 'sound:pls-entr-num-uwish2-call'}, playback);

      updateState(client, bridge.name, states.BUSY);
      outbound.on('ChannelDtmfReceived', onDtmfReceived);
      outbound.once('ChannelHangupRequest', onEarlyOutboundHangup);
    } else {
      console.log('CALL IN PROGRESS');
      defer.resolve();
    }
  });
  return defer.promise;

  /**
   * Function that gets called when the outbound channel enters the application
   *   but hangs up before specifying the channel to dial.
   *   Mainly there so that a nonexistant dialed channel doesn't get hung up.
   * @param {Object} event - the event object related to this hang up.
   */
  function onEarlyOutboundHangup(event) {
    updateState(client, bridge.name, states.IDLE);
    defer.reject(new customError.CustomError('EarlyOutboundHungup',
          'Outbound channel hungup before dialing'));
  }

  /**
   * Function that gets called when a DTMF digit is received from the outbound
   *   channel. Originates a channel to the specified extension at the trunk
   *   in the configuration file when the '#' key is pressed
   * @param {Object} event - the event object related to this DTMF input.
   *   Contains the DTMF digit as well.
   * @param {Object} channel - the channel that sent this DTMF
   */
  function onDtmfReceived(event, channel) {
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

        updateState(client, bridge.name, states.RINGING);

        channelToDial.once('StasisStart', onTrunkEnteredStasis);
        channelToDial.once('ChannelDestroyed', onTrunkHangup);
        outbound.removeListener('ChannelHangupRequest',
          onEarlyOutboundHangup);
        outbound.once('ChannelHangupRequest', onOutboundHangup);
        break;

      default:
        toDial += digit;
        break;
    }
  }
}
module.exports = originateOutbound;
