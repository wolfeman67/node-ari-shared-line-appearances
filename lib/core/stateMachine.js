'use strict';

var util = require('util');

var Q = require('q');

var getOrCreateBridge = require('./helpers/getOrCreateBridge.js');
var originator = require('./helpers/originator.js');

/**
 * Creates a state machine for a shared extension.
 * @param {Client} client - the asterisk client instance
 * @param {Object} data - the data (trunks, stations, etc.) related to this
 *   extension
 * @param {Channel} channel - the incoming channel
 * @returns {Object} stateMachine- the state machine related to this extension
 * @returns {Function} stateMachine.init - the function that initializes the
 *   state machine.
 */
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

    /**
     * Adds a participant to the participants object.
     * @param {Channel} participant - the participant channel to be added
     */
    addParticipant: function(participant) {
      participants[participant.id] = participant;

      participant.once('StasisStart', this.onParticipantStasisStart);
      participant.once('ChannelDestroyed', this.onParticipantHangup);
    },
    /**
     * Figures out if the participants object is empty.
     * @returns {Boolean} - if participants is empty
     */
    participantsIsEmpty: function() {
      return !Object.keys(participants).length;
    },

    /**
     * Determines if a channel, determined by id, is a station.
     * @param {String} candidateId - the id of the channel in question
     * @returns {Boolean} - whether or not a channel is a station
     */
    isStation: function(candidateId) {
      console.log('isStation: ' + candidateId);
      console.log(participants);

      if (candidateId === channel.id) {
        return channel.isStation;
      } else {
        return participants[candidateId].isStation;
      }
    },

    /**
     * Cleans up the event listeners of a participant.
     * @param {Channel} participant - the participant channel
     */
    cleanupParticipantEvents: function(participant) {
      participant.removeListener('StasisStart',
                                   this.onParticipantStasisStart);
      participant.removeListener('ChannelDestroyed',
                                 this.onParticipantHangup);
    },

    /**
     * Updates the state (both for ARI and the stateMachine).
     * @param {String} state - the state to update to
     */
    updateState: function(state) {
      var deviceState = Q.denodeify(
        client.deviceStates.update.bind(client)
      );

      this.currentState = state;

      deviceState({
        deviceName: util.format('Stasis:%s', data.extension.name),
        deviceState: state
      });
    },

    /**
     * State machine intializer. Answers incoming channel and determines the
     *   device state, and relevant data.
     * @param {Channel} channel - the incoming channel
     */
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

    /**
     * What gets called when an outside channel tries to enter a busy extension.
     */
    busy: function () {
      channel.continueInDialplan();
      this.exit();
    },

    /**
     * Fetches the bridge.
     */
    getBridge: function() {
      // Get the bridge if it exists, else create a new one
      getOrCreateBridge.call(this, {
        client: client,
        data: data
      });
    },

    /**
     * Takes in the bridge and fires up the originator object.
     * @param {Bridge} instance - the bridge instance returned from the module
     */
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

    /**
     * Allows the incoming channel and participant channel to join the bridge.
     * @param {Channel} participant - participant channel that entered Stasis
     */
    joinBridge: function(participant) {
      var addChannel = Q.denodeify(bridge.addChannel.bind(bridge));

      addChannel({channel: channel.id})
        .done();

      if (participant) {
        addChannel({channel: participant.id})
          .done();
      }
    },

    /**
     * Sets up dtmf event listeners for the incoming channel.
     */
    getDtmf: function() {
      this.dialString = '';
      channel.on('ChannelDtmfReceived', this.onChannelDtmfReceived);
    },

    /**
     * Once stations are ready, start originating channels.
     */
    stationsReady: function() {
      var self = this;

      data.extension.stations.forEach(function(station) {
        self.originator.originate(
          station,
          {isStation: true}
        );
      });
    },

    /**
     * What gets called when the shared extension is to be cleared.
     * @param {String/Error} err - a error denoted by a string
     */
    exit: function(err) {
      var self = this;

      // Cleanup event listeners.
      bridge.removeListener('ChannelLeftBridge',
                            this.onChannelLeftBridge);
      channel.removeListener('ChannelHangupRequest',
                             this.onChannelHangup);
      channel.removeListener('ChannelDtmfReceived',
                             this.onChannelDtmfReceived);

      // If there are participants, hang them up.
      if(participants.length) {

        participants.forEach(function(participant) {
          self.cleanupParticipantEvents(participant);
        });
      }

      // If there is an error, hangup the original incoming channel.
      if (err) {
        var hangup = Q.denodeify(channel.hangup.bind(channel));

        hangup();
      }
    },

    // Event handlers
    /**
     * What gets called when a incoming channel hangs up.
     */
    onChannelHangup: function() {
    	// If there are no participants, exit the application.
      if (stateMachine.participantsIsEmpty()) {
        stateMachine.exit();
      }

      // If there are participants, hang them all up.
      if(participants.length) {
        participants.forEach(function(participant) {
          var hangup = Q.denodeify(participant.hangup.bind(participant));

          hangup();
        });
      }
    },

    /**
     * When a channel leaves the bridge.
     * @param {Object} event - the event object
     * @param {Object} object - the object that contains a channel and bridge
     */
    onChannelLeftBridge: function(event, object) {

      console.log(util.format('Channel %s left the bridge'), object.channel.id);
      console.log('Dialed in channel: ' + channel.id);

      var isStation = stateMachine.isStation(object.channel.id);

      if (isStation) {

        console.log('A station left');

        // filter for non stations, if it matches length, hang them all up.
        var nonStations = object.bridge.channels.filter(function(candidateId) {
          console.log(candidateId);

          return !stateMachine.isStation(candidateId);
        });

        // If the only channels are non-stations, hang those channels up.
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

      // If there are no more channels, exit the application.
      if (bridge.channels.length === 0) {

        stateMachine.updateState(stateMachine.states.IDLE);

        stateMachine.exit();
      }
    },

    /**
     * What gets called when an incoming channel receives dtmf input.
     *   Originates a channel when the # key is pressed.
     * @param {Object} event - the event object that contains the dtmf key
     */
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

    /**
     * What gets called when a participant enters Stasis.
     * @param {Object} event - the event object related to the StasisStart
     * @param {Channel} participant - the participant that entered Stasis
     */
    onParticipantStasisStart: function(event, participant) {

      stateMachine.trunkEnteredStasis = true;

      var answer = Q.denodeify(participant.answer.bind(participant));
      answer();

      var channels = Object.keys(participants).filter(function(candidate) {
        return candidate !== participant.id;
      });

      // The remaining participants get hung up.
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

    /**
     * What gets called when a participant hangs up.
     * @param {Object} event - the event object related to the hangup
     * @param {Channel} participant - the participant that hung up
     */
    onParticipantHangup: function(event, participant) {
      delete participants[participant.id];

      // Exits the application if all hang up.
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
/**
 * Creates a state machine and returns it.
 * @param {Client} client - the ARI client object
 * @param {Object} data - the data related to the shared extension
 * @param {Channel} channel - the incoming channel
 * @returns {Object} - the state machine to be used
 */
module.exports = function(client, data, channel) {
  return create(client, data, channel);
};
