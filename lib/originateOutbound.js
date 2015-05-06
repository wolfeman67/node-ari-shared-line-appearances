var Q = require('q');
var updateState = require('./updateState.js');
var callInProgress = require('./callInProgress.js');
var customError = require('./customError.js');
/**
 * The function that starts originating an outbound call
 * @param {Object} client - the ARI client that has access to neede objects
 * @param {Object} extsInUse - represents what extensions are in use and
 *   their properties/channels
 * @param {Object} outbound - the outbound channel object
 * @param {Object} bridge - the bridge used in this outbound call
 * @param {Object} states - the list of possible states
 * @return {Object} - Q promise object
 */
function originateOutbound(client, extsInUse, outbound, bridge, states) {
  var toDial = '';
  var channelsToDial = [];
  var defer = Q.defer();
  var extName = bridge.name;
  var currentState = extsInUse[extName].currentState;
  var trunkData = extsInUse[extName].trunks;

  if (!callInProgress(currentState, states)) {
    var playback = client.Playback();
    outbound.play({media: 'sound:pls-entr-num-uwish2-call'}, playback);

    updateState(client, extsInUse, extName, states.BUSY);
    outbound.on('ChannelDtmfReceived', dtmfReceived);
    outbound.once('ChannelHangupRequest', outboundHungupEarly);
  } else {
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
    line.removeListener('ChannelDestroyed', dialedTrunkHungup);
    outbound.removeListener('ChannelDtmfReceived', dtmfReceived);
    extsInUse[extName].currentTrunk = line.name;
    var answer = Q.denodeify(line.answer.bind(line));
    answer();

    channelsToDial.forEach(function(chan) {
      chan.removeListener('ChannelDestroyed', dialedTrunkHungup);
      if (chan.id !== line.id) {
        var hangup = Q.denodeify(chan.hangup.bind(chan));
        hangup();
      }
    });

    defer.resolve(line);
  }

  /**
   * Function that gets called when a dialed channel hangs up
   * @param {Object} event - the event object related to this hang up
   */
  function dialedTrunkHungup(event, line) {
    var index = channelsToDial.indexOf(line);
    channelsToDial.splice(index, 1);
    if (channelsToDial.length === 0) {
      updateState(client, extsInUse, extName, states.IDLE);
      outbound.removeListener('ChannelHangupRequest', outboundHungup);
      outbound.removeListener('ChannelDtmfReceived', dtmfReceived);
      defer.reject(new customError.CustomError('DialedHungup',
        'Dialed trunks hungup'));
    }
  }
  /**
   * Function that gets called when the outbound caller hangs up with a
   * calling in progress
   * @param {Object} event - the event object related to this hang up
   * @param {line} line - the channel that hungup
   */
  function outboundHungup(event, line) {
    updateState(client, extsInUse, extName, states.IDLE);
    channelsToDial.forEach(function(chan) {
      chan.removeListener('ChannelDestroyed', dialedTrunkHungup);
      var hangup = Q.denodeify(chan.hangup.bind(
        chan));
      hangup();
    });
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
        trunkData.forEach(function(trunk) {
          originateToTrunk(trunk);
        });

        updateState(client, extsInUse, extName, states.RINGING);
        outbound.removeListener('ChannelHangupRequest', outboundHungupEarly);
        outbound.once('ChannelHangupRequest', outboundHungup);
        break;

      default:
        toDial += digit;
        break;
    }
  }

  function originateToTrunk(trunk) {
    channelsToDial.push(client.Channel());
    var index = channelsToDial.length - 1;
    var originate = Q.denodeify(channelsToDial[index].originate.bind(
      channelsToDial[index]));
    originate({endpoint: 'SIP/' + toDial + '@' + trunk,
      app: 'sla',
      appArgs: 'dialed',
      timeout: 10,
      variables: {'CALLERID(name)': extName}});
    channelsToDial[index].once('StasisStart', dialedTrunkEnteredStasis);
    channelsToDial[index].once('ChannelDestroyed', dialedTrunkHungup);
  }
}
module.exports = originateOutbound;