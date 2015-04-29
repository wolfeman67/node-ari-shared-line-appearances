'use strict';

var getOrCreateBridge = require('./helpers/getOrCreateBridge.js');
var originate = require('./helpers/originate.js');

var states = {
  BUSY: 'BUSY',
  INUSE: 'INUSE',
  IDLE: 'NOT_INUSE',
  RINGING: 'RINGING',
};

function create(client, data, channel) {
  // TODO: what should default state be?
  var status = states.RINGING;
  var bridge;

  return {
    joinSla: function() {
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

    exit: function() {
      bridge.removeListener('ChannelEnteredBridge',
                            this.onChannelEnteringBridge);
      bridge.removeListener('ChannelLeftBridge',
                            this.onChannelExitingBridge);
    }
  };
}

module.exports = function(client, data, channel) {
  var state = create(client, data, channel);

  return state;
};
