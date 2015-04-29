'use strict';

var getOrCreateBridge = require('./helpers/getOrCreateBridge.js');
var originate = require('./helpers/originate.js'); //TODO : MAKE THIS

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
    init: function() {
      var self = this;

      // Answer the channel
      Q.denodeify(channel.answer.bind(channel))()
        .then(function() {
          self.joinSla();
        })
        .done();
    }

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

    exit: function() {
      bridge.removeListener('ChannelEnteredBridge',
                            this.onChannelEnteringBridge);
      bridge.removeListener('ChannelLeftBridge',
                            this.onChannelExitingBridge);
    }
  };
}

module.exports = function(client, data, channel) {
  return create(client, data, channel);
};
