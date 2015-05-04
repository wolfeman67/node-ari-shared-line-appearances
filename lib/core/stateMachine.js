'use strict';

var util = require('util');

var Q = require('q');

var getOrCreateBridge = require('./helpers/getOrCreateBridge.js');
var originator = require('./helpers/originator.js');

function create(client) {
  var bridge;

  // Stations and trunks are temporary until I figured out how to use
  // participants.
  var stations = {};
  var trunk = {};
  var participants = {};
  var data;

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
      if (stations[candidateId]) {

        return stations[candidateId].isStation;
      } else if (trunk.id === candidateId) {

        return trunk.isStation;
      } else {

        return participants[candidateId].isStation;
      }
    },

    cleanupParticipantEvents: function(id) {
      var participant = participants[id];
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
    init: function(channel, extensionData) {
      var self = this;

      data = extensionData;

      var extensionName = data.extension.name;

      channel.isStation = data.isStation;

      console.log(Object.keys(stations).length);
      console.log(trunk.id);

      // Answer the channel
      var answered = Q.denodeify(channel.answer.bind(channel))();

      //This will go back into originator once more research is complete
      if (channel.isStation) {
        if (Object.keys(stations).length) {
          self.joinBridge(channel);
          stations[channel.id] = channel;
          return;
        }

        stations[channel.id] = channel;

      } else {
        if (!trunk.id && (!this.currentState ||
              (this.currentState === self.states.IDLE ||
               this.currentState === self.states.UNKNOWN
              )
            )
          ) {

          trunk = channel;

        } else {
          self.busy(channel);
          return;
        }
      }

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

        self.getBridge(channel);
      })
      .done();
    },

    busy: function (channel) {
      channel.continueInDialplan();
      this.exit(channel);
    },

    getBridge: function(channel) {
      // Get the bridge if it exists, else create a new one
      getOrCreateBridge.call(this, {
        client: client,
        data: data,
        channel: channel
      });
    },

    bridgeLoaded: function(instance, channel) {
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

    joinBridge: function(channel, participant) {
      var addChannel = Q.denodeify(bridge.addChannel.bind(bridge));

      addChannel({channel: channel.id})
        .done();
        console.log('Incoming added');

      if (participant) {
        addChannel({channel: participant.id})
          .done();
          console.log('Participant added');
      }
    },

    getDtmf: function(channel) {
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

    exit: function(channel, err) {

      var self = this;

      // If the application is finished
      if (!Object.keys(stations).length && !Object.keys(trunk).length) {
        console.log('Application completed!');
        participants = {};
        stateMachine.updateState(stateMachine.states.IDLE);

        bridge.removeListener('ChannelLeftBridge',
                              this.onChannelLeftBridge);

        if (participants.length) {
          participants.forEach(function(participant) {
            self.cleanupParticipantEvents(participant);
          });
        }
      }

      channel.removeListener('ChannelHangupRequest',
                             this.onChannelHangup);
      channel.removeListener('ChannelDtmfReceived',
                             this.onChannelDtmfReceived);

      if (err) {
        var hangup = Q.denodeify(channel.hangup.bind(channel));

        hangup();
      }
    },

    // event handlers
    onChannelHangup: function(event, channel) {

      if (stateMachine.participantsIsEmpty()) {
        stateMachine.exit(channel);
      }

      if (participants.length) {
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

      var isStation = stateMachine.isStation(object.channel.id);

      if (isStation) {

        delete stations[object.channel.id];

        console.log('A station left');

        // filter for non stations, if it matches length, hang them all up
        var nonStations = object.bridge.channels.filter(function(candidateId) {

          return !stateMachine.isStation(candidateId);
        });

        if (trunk && object.bridge.channels.length === 1) {
          console.log('All stations hungup, hanging up trunk');

          var hangup = Q.denodeify(client.channels.hangup.bind
              (client));

          object.bridge.channels.forEach(function(id) {
            hangup({channelId: id});
          });
        }
      } else {
        trunk = {};
        console.log('The trunk left');
      }

      if (bridge.channels.length === 0) {

        stateMachine.exit(object.channel);
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

      var remaining = participants[participant.id];

      channels.forEach(function(id) {
        console.log('Hanging up the rest');

        var hangup = Q.denodeify(client.channels.hangup.bind(client));

        hangup({channelId: id});

        stateMachine.cleanupParticipantEvents(id);
      });

      stateMachine.updateState(stateMachine.states.INUSE);

      var channel;

      if (Object.keys(trunk).length) {
        channel = trunk;
        stations[participant.id] = remaining;
      } else {
        channel = stations[Object.keys(stations)[0]];
        trunk = remaining;
      }

      console.log('Joining the bridge');

      stateMachine.joinBridge(channel, remaining);
    },

    onParticipantHangup: function(event, participant) {
      delete participants[participant.id];

      if (stateMachine.participantsIsEmpty() &&
          !stateMachine.trunkEnteredStasis) {

        console.log('All participants hungup');

        stateMachine.updateState(stateMachine.states.IDLE);

        var channel;

        if (trunk) {
          channel = trunk;
        } else {
          channel = stations[Object.keys(stations)[0]];
        }
        // Reset the trunk and stations
        trunk = {};
        stations = {};

        stateMachine.exit(channel, 'DialedChannelsHungup');
      }
    }
  };

  return stateMachine;
}

module.exports = function(client) {
  return create(client);
};
