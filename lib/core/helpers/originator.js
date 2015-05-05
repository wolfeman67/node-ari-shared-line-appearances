'use strict';

var Q = require('q');
var customError = require('../../util/customError.js');

/**
 * Exports the initializer and originate logic to allow for calls to be made and
 *   handled appropriately.
 * @param {Object} opts - Contains the data for the client, bridge, channel,
 *   extension and the isStation verifier function.
 * @param {Object} client - the ARI client instance
 * @param {Object} bridge - the bridge that is being used by this extension
 * @param {Object} channel - the incoming channel object (inbound or outbound)
 * @param {Object} data - the data relevant to this shared extension
 */
module.exports = function(opts) {

  var client = opts.client;
  var bridge = opts.bridge;
  var channel = opts.channel;
  var isStation = opts.data.isStation;
  var extension = opts.data.extension;
  var self = this;

  return {

    /**
     * Sets up the logic for inbound and outbound dialing
     * If inbound, sets up stations and returns to stationsReady.
     * If outbound, returns to set up channel DTMF input.
     * If there are either no trunks, or no stations, exits application.
     */
    init: function() {

      if (isStation) {
        // outbound logic

        if (!extension.trunks.length) {
          self.exit(
            new customError.CustomError(
              'NoTrunks',
              'No trunks in this shared extension.'
            )
          );

          return;
        }


        if (self.currentState !== self.states.IDLE &&
            self.currentState !== self.states.UNKNOWN) {

          self.joinBridge(channel);

          return;
        }

        var playback = client.Playback();
        channel.play({media: 'sound:pls-entr-num-uwish2-call'}, playback);

        self.updateState(self.states.BUSY);

        self.getDtmf();
      } else {
        // inbound logic

        if (!extension.stations.length) {
          self.exit(
            new customError.CustomError(
              'NoStations',
              'No stations in this shared extension.'
            )
          );

          return;
        }

        if (self.currentState !== self.states.IDLE &&
            self.currentState !== self.states.UNKNOWN) {

          channel.continueInDialplan();
          self.busy();

          return;
        }

        self.updateState(self.states.RINGING);

        self.stationsReady();
      }
    },

    /**
     * Originates a call to the specified endpoint.
     * @param {String} endpoint - Endpoint to originate the call to.
     * @param {Object} metadata - Arbitrary metadata to attach to participant
     *   channel.
     */
    originate: function(endpoint, metadata) {
      var participant = client.Channel();

      Object.keys(metadata).forEach(function(property) {
        participant[property] = metadata[property];
      });

      var originate = Q.denodeify(participant.originate.bind(participant));

      originate ({
        endpoint: endpoint,
        app: 'sla',
        appArgs: 'dialed',
        timeout: 10
      });

      self.addParticipant(participant);
    }
  };
};
