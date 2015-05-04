'use strict';

var util = require('util');

var Q = require('q');

var getOrCreateBridge = require('./helpers/getOrCreateBridge.js');
var originator = require('./helpers/originator.js');

function create(client, data, channel) {
  var bridge;
  var participants = {};

  var stateMachine = {
    states: {
      BUSY: 'BUSY',
      INUSE: 'INUSE',
      IDLE: 'NOT_INUSE',
      RINGING: 'RINGING',
      UNKNOWN: 'UNKNOWN'
    },

    dialString: '',

    allowDtmf: true,

    trunkEnteredStasis: false,

    // helpers
    addParticipant: function(participant) {
      participants[participant.id] = participant;

      participant.once('StasisStart', this.onParticipantStasisStart);
      participant.once('ChannelDestroyed', this.onParticipantHangup);
    },

    participantsIsEmpty: function() {
      return !Object.keys(participants).length;
    },

    isStation: function(candidateId) {
      console.log('isStation: ' + candidateId);
      console.log(participants);

      if (candidateId === channel.id) {
        return channel.isStation;
      } else {
        return participants[candidateId].isStation;
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
    init: function(channel) {
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
        self.currentState = deviceState.state;

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

      if(participants.length) {

        participants.forEach(function(participant) {
          self.cleanupParticipantEvents(participant);
        });
      }

      if (err) {
        var hangup = Q.denodeify(channel.hangup.bind(channel));

        hangup();
      }
    },

    // event handlers
    onChannelHangup: function() {

      if (stateMachine.participantsIsEmpty()) {
        stateMachine.exit();
      }

      if(participants.length) {
        participants.forEach(function(participant) {
          var hangup = Q.denodeify(participant.hangup.bind(participant));

          hangup();
        });
      }
    },

    // requirement: if all stations hangup, caller is hungup
    // currently: if caller hangs up, all stations are hungup
    onChannelLeftBridge: function(event, object) {

      console.log(util.format('Channel %s left the bridge'), object.channel.id);
      console.log('Dialed in channel: ' + channel.id);

      var isStation = stateMachine.isStation(object.channel.id);

      if (isStation) {

        console.log('A station left');

        // filter for non stations, if it matches length, hang them all up
        var nonStations = object.bridge.channels.filter(function(candidateId) {
          console.log(candidateId);

          return !stateMachine.isStation(candidateId);
        });

        if (nonStations.length === object.bridge.channels.length) {
          console.log('All stations hungup, hanging up trunk');

          var hangup = Q.denodeify(client.channels.hangup.bind
              (client));

          object.bridge.channels.forEach(function(id) {
            hangup({channelId: id});
          });
        }
      } else {
        console.log('The trunk left');
      }

      if (bridge.channels.length === 0) {

        stateMachine.updateState(stateMachine.states.IDLE);

        stateMachine.exit();
      }
    },

    onChannelDtmfReceived: function(event) {
      if (!stateMachine.allowDtmf) {
        return;
      }

      var digit = event.digit;

      switch (digit) {
        case '#':
          stateMachine.updateState(stateMachine.states.RINGING);

          stateMachine.allowDtmf = false;

          stateMachine.originator.originate(
            util.format(
              'SIP/%s@%s',
              stateMachine.dialString,
              data.extension.trunks[0]
            ),
            {isStation: false}
          );

          break;

        default:
          stateMachine.dialString += digit;

          break;
      }
    },

    onParticipantStasisStart: function(event, participant) {

      stateMachine.trunkEnteredStasis = true;

      var answer = Q.denodeify(participant.answer.bind(participant));
      answer();

      var channels = Object.keys(participants).filter(function(candidate) {
        return candidate !== participant.id;
      });

      channels.forEach(function(id) {

        var getChannel = Q.denodeify(client.channels.get.bind(client));

        getChannel({channelId: id}).then(function(member) {
          var hangup = Q.denodeify(member.hangup.bind(member));

          hangup();

          stateMachine.cleanupParticipantEvents(member);
        });
      });

      stateMachine.updateState(stateMachine.states.INUSE);

      stateMachine.joinBridge(participant);
    },

    onParticipantHangup: function(event, participant) {
      delete participants[participant.id];

      if (stateMachine.participantsIsEmpty() &&
          !stateMachine.trunkEnteredStasis) {

        console.log('All participants hungup');

        stateMachine.updateState(stateMachine.states.IDLE);
        stateMachine.exit('EarlyChannelHangup');
      }
    }
  };

  return stateMachine;
}

module.exports = function(client, data, channel) {
  return create(client, data, channel);
};
