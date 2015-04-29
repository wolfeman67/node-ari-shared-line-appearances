'use strict';

//var Q = require('q');
//var customError = require('./customError.js');
//var getState = require('./getState.js');
//var updateState = require('./updateState.js');
//var states = require('./states.js');

module.exports = function(opts) {

  var client = opts.client;
  var bridge = opts.bridge;
  var channel = opts.channel;
  var isStation = opts.data.isStation;
  var extension = opts.data.extension;

  //originate(client, bridge, extension)

  if (isStation) {
    // outbound logic
    return originateOutbound(client, trunks, channel, bridge);
  } else {
      // inbound logic
      if (!extension.stations.length) {
        this.busy(new customError.CustomError('NoStations',
              'No stations in this shared extension.'));
      }

      if (!this.currentState === states.IDLE &&
        !this.currentState === states.UNDEFINED) {
        channel.continueInDialplan();
        this.busy();
      }

      var dialed = [];
      updateState(client, bridge.name, states.RINGING);
      stations.forEach(function(station) {
        var channel = client.Channel();
        dialed.push(channel);
        var originate = Q.denodeify(channel.originate.bind(channel));
        originate({endpoint: station, app: 'sla',
          appArgs: 'dialed', timeout: 10})
          .catch(function (err) {
            defer.reject(err);
          });
        channel.once('StasisStart', onStationEnteredStasis);
        channel.once('ChannelDestroyed', onStationHangup);
      });
      inbound.once('ChannelHangupRequest', onInboundHangup);
    }
  });
  return defer.promise;
     return originateInbound(client, channel, bridge, extensionName);
  }
};
