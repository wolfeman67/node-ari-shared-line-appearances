'use strict';

var Q = require('q');
var customError = require('../../util/customError.js');

var preOriginate = function (opts) {
  var self = this;

  var client = opts.client;
  var bridge = opts.bridge;
  var channel = opts.channel;
  var isStation = opts.data.isStation;
  var extension = opts.data.extension;

  if (isStation) {
    // outbound logic

    if (!extension.trunks.length) {
      this.exit(
        new customError.CustomError(
          'NoTrunks',
          'No trunks in this shared extension.'
        )
      );

      return;
    }

    if (this.currentState !== this.states.IDLE &&
        this.currentState !== this.states.UNKNOWN) {

      this.joinBridge(channel);

      return;
    }

    var playback = client.Playback();
    channel.play({media: 'sound:pls-entr-num-uwish2-call'}, playback);

    this.updateState(this.states.BUSY);

    this.getDtmf();

    return;
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
        this.currentState !== this.states.UNKNOWN) {

      channel.continueInDialplan();
      this.busy();

      return;
    }

    this.updateState(this.states.RINGING);

    extension.stations.forEach(function(station) {
      this.originate(station);
    });
  }
};

var originate = function(endpoint) {
  var participant = client.Channel();

  var originate = Q.denodeify(participant.originate.bind(participant));

  originate ({
    endpoint: endpoint,
    app: 'sla',
    appArgs: 'dialed',
    timeout: 10
  });

  self.addParticipant(participant);
};

module.exports = {
  preOriginate: preOriginate,
  originate: originate
};
