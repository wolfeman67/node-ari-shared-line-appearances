'use strict';

var util = require('util');

var Q = require('q');

var getOrCreateBridge = require('./helpers/getOrCreateBridge.js');
var originator = require('./helpers/originator.js');

function create(client, data, channel) {
  var bridge;
  var participants = {};

  return {
    states: {
      BUSY: 'BUSY',
      INUSE: 'INUSE',
      IDLE: 'NOT_INUSE',
      RINGING: 'RINGING',
      UNKNOWN: 'UNKNOWN'
    },

    dialString: '',

    allowDtmf: true,

    init: function() {
      var self = this;

      var extensionName = data.extension.name;

      // Answer the channel
      var answered = Q.denodeify(channel.answer.bind(channel))();

      // Get the current device state
      var getDeviceState = Q.denodeify(
        client.deviceStates.get.bind(client.deviceStates)
      );

      answered.then(function() {
        return getDeviceState({
          deviceName: util.format('Stasis:%s', extensionName)
        });
      }).then(function (deviceState) {
        self.currentState = deviceState;

        self.getBridge();
      })
      .done();
    },

    busy: function () {
      channel.continueInDialplan();
      this.exit();
    },

    getBridge: function() {
      // Get the bridge if it exists, else create a new one
      getOrCreateBridge.call(this, {
        client: client,
        data: data
      });
    },

    bridgeLoaded: function(instance) {
      bridge = instance;

      bridge.on('ChannelEnteredBridge', this.onChannelEnteringBridge);
      bridge.on('ChannelLeftBridge', this.onChannelExitingBridge);

      this.originator = originator.call(this, {
        client: client,
        channel: channel,
        bridge: bridge,
        data: data
      });

      this.originator.init();

      channel.once('ChannelHangupRequest', this.onChannelHangup);
    },

    joinBridge: function(participant) {
      var addChannel = Q.denodeify(bridge.addChannel.bind(bridge));

      addChannel({channel: channel.id})
        .done();

      if (participant) {
        addChannel({channel: participant.id})
          .done();
      }
    },

    updateState: function(state) {
      var deviceState = Q.denodeify(
        client.deviceStates.update.bind(client)
      );

      this.currentState = state;

      return deviceState({
        deviceName: util.format('Stasis:%s', data.extension.name),
        deviceState: state
      });
    },

    getDtmf: function() {
      this.dialString = '';
      channel.on('ChannelDtmfReceived', this.onChannelDtmfReceived);
    },

    addParticipant: function(participant) {
      participants[participant.id] = participant;

      participant.once('StasisStart', this.onParticipantStasisStart);
      participant.once('ChannelDestroyed', this.onParticipantHangup);
    },

    participantsIsEmpty: function() {
      return !Object.keys(participants).length;
    },

    cleanupParticipantEvents: function(participant) {
      participant.removeListener('StasisStart',
                                   this.onParticipantStasisStart);
      participant.removeListener('ChannelDestroyed',
                                 this.onParticipantHangup);
    },

    onChannelHangup: function() {
      if (this.participantsIsEmpty()) {
        this.exit();
      }
      participants.forEach(function(participant) {
        var hangup = Q.denodeify(participant.hangup.bind(participant));

        hangup();
      });
    },

    onChannelExitingBridge: function() {
      // TODO: complete!
    },

    onChannelDtmfReceived: function(event, channel) {
      if (!this.allowDtmf) {
        return;
      }

      var digit = event.digit;

      switch (digit) {
        case '#':
          this.updateState(this.states.RINGING);

          this.allowDtmf = false;

          this.originator.originate(
            util.format(
              'SIP/%s@%s',
              this.dialString,
              data.extension.trunks[0]
            )
          );

          break;

        default:
          this.dialString += digit;

          break;
      }
    },

    onParticipantStasisStart: function(event, participant) {
      var self = this;

      var answer = Q.denodeify(participant.answer.bind(participant));
      answer();

      var channels = Object.keys(participants).filter(function(candidate) {
        return candidate.id !== participant.id;
      });

      channels.forEach(function(channel) {
        var hangup = Q.denodeify(channel.hangup.bind(channel));

        hangup();

        self.cleanupParticipantEvents(channel);
      });

      this.updateState(this.states.INUSE);

      this.joinBridge(participant);
    },

    onParticipantHangup: function(event, participant) {
      delete participants[participant.id];

      if (this.participantsIsEmpty()) {
        this.updateState(this.states.IDLE);
        this.exit();
      }
    },

    exit: function(err) {
      var self = this;

      // cleanup event listeners
      bridge.removeListener('ChannelEnteredBridge',
                            this.onChannelEnteringBridge);
      bridge.removeListener('ChannelLeftBridge',
                            this.onChannelExitingBridge);
      channel.removeListener('ChannelHangupRequest',
                             this.onChannelHangup);
      channel.removeListener('ChannelDtmfReceived',
                             this.onChannelDtmfReceived);

      participants.forEach(function(participant) {
        self.cleanupParticipantEvents(participant);
      });

      if (err) {
        var hangup = Q.denodeify(channel.hangup.bind(channel));

        hangup();
      }
    }
  };
}

module.exports = function(client, data, channel) {
  return create(client, data, channel);
};
