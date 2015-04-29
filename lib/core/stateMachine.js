'use strict';

var util = require('util');

var getOrCreateBridge = require('./helpers/getOrCreateBridge.js');
var originate = require('./helpers/originate.js'); //TODO : MAKE THIS

var states = {
  BUSY: 'BUSY',
  INUSE: 'INUSE',
  IDLE: 'NOT_INUSE',
  RINGING: 'RINGING',
};

function create(client, data, channel) {
  var bridge;

  return {
    states: {
      BUSY: 'BUSY',
      INUSE: 'INUSE',
      IDLE: 'NOT_INUSE',
      RINGING: 'RINGING',
      UNDEFINED: 'UNDEFINED' // TODO : GO LOOK AT ASTERISK TO VERIFY
                             // THIS IS THE CORRECT STRING
    },

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
        self.currentState = ds.deviceState;

        self.joinSla();
      })
      .done();
    },

    busy: function () {
      channel.continueInDialplan();
      this.exit()
    },

    joinSla: function() {
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

      originate.call(this, {
        client: client,
        channel: channel,
        bridge: bridge,
        data: data
      });
    },

    onChannelEnteringBridge: function() {

    },

    onChannelExitingBridge: function() {

    },

    exit: function(err) {
      bridge.removeListener('ChannelEnteredBridge',
                            this.onChannelEnteringBridge);
      bridge.removeListener('ChannelLeftBridge',
                            this.onChannelExitingBridge);

      if (err) {
        // TODO : HANGUP CHANNEL
      }
    }
  };
}

module.exports = function(client, data, channel) {
  return create(client, data, channel);
};
