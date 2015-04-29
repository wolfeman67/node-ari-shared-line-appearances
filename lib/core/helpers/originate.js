'use strict';

var Q = require('q');
var customError = require('../util/customError.js');

module.exports = function(opts) {

  var self = this;

  var client = opts.client;
  var bridge = opts.bridge;
  var channel = opts.channel;
  var isStation = opts.data.isStation;
  var extension = opts.data.extension;

  if (isStation) {
    // outbound logic
    return originateOutbound(client, trunks, channel, bridge);
  } else {
      // inbound logic
      if (!extension.stations.length) {
        this.exit(
          new customError.CustomError(
            'NoStations',
            'No stations in this shared extension.'
          )
        );

        return;
      }

      if (this.currentState !== this.states.IDLE &&
          this.currentState !== this.states.UNDEFINED) {
        channel.continueInDialplan();
        this.busy();

        return;
      }

      this.updateState(this.states.RINGING);

      extension.stations.forEach(function(station) {
        var participant = client.Channel();

        //dialed.push(channel);
        var originate = Q.denodeify(participant.originate.bind(participant));

        originate({
          endpoint: station,
          app: 'sla',
          appArgs: 'dialed',
          timeout: 10
        });

        self.addParticipant(participant);
      });
    }
};
