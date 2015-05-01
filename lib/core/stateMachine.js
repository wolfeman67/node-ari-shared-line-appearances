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

    // helpers
    addParticipant: function(participant) {
      participants[participant.id] = participant;

      participant.once('StasisStart', this.onParticipantStasisStart);
      participant.once('ChannelDestroyed', this.onParticipantHangup);
    },

    participantsIsEmpty: function() {
      return !Object.keys(participants).length;
    },

    isStation: function(candidate) {
      if (candidate.id === channel.id) {
        return channel.isStation;
      } else {
        return participants[candidate.id].isStation;
      }
    },

    cleanupParticipantEvents: function(participant) {
      participant.removeListener('StasisStart',
                                   this.onParticipantStasisStart);
      participant.removeListener('ChannelDestroyed',
                                 this.onParticipantHangup);
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

    // state transitions
    init: function() {
      var self = this;

      var extensionName = data.extension.name;

      channel.isStation = data.isStation;

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

      bridge.on('ChannelLeftBridge', this.onChannelLeftBridge);

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

    getDtmf: function() {
      this.dialString = '';
      channel.on('ChannelDtmfReceived', this.onChannelDtmfReceived);
    },

    stationsReady: function() {
      var self = this;

      data.extension.stations.forEach(function(station) {
        self.originator.originate(
          station,
          {isStation: true}
        );
      });
    },

    exit: function(err) {
      var self = this;

      // cleanup event listeners
      bridge.removeListener('ChannelLeftBridge',
                            this.onChannelLeftBridge);
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
    },

    // event handlers
    onChannelHangup: function() {
      if (this.participantsIsEmpty()) {
        this.exit();
      }

      participants.forEach(function(participant) {
        var hangup = Q.denodeify(participant.hangup.bind(participant));

        hangup();
      });
    },

    // requirement: if all stations hangup, caller is hungup
    // currently: if caller hangs up, all stations are hungup
    onChannelLeftBridge: function(event, object) {
      var self = this;

      var isStation = this.isStation(object.channel);

      if (isStation) {

        // filter for non stations, if it matches length, hang them all up
        var nonStations = bridge.channels.filter(function(candidate) {
          return !self.isStation(candidate);
        });

        if (nonStations.length === bridge.channels.length) {
          var hangup = Q.denodeify(client.channels.hangup.bind
              (client));

          bridge.channels.forEach(function(id) {
            hangup({channelId: id});
          });
        }
      }

      if (bridge.channels.length === 0) {
        this.updateState(this.states.IDLE);

        this.exit();
      }
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
            ),
            {isStation: false}
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
    }
  };
}

module.exports = function(client, data, channel) {
  return create(client, data, channel);
};
