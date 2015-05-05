'use strict';

var util = require('util');

var ari = require('ari-client');
var Q = require('q');

var sla = require('./sla.application.js');
var config = require('./config/app.config.json');

/**
 * Waits for a StasisStart event before going into the main SLA module.
 * @param {Client} client - Asterisk ARI client instance
 * @param {String} confFilePath - File path for the configuration file.
 */
function clientLoaded (client, confFilePath) {
  client.start('sla');

  client.on('StasisStart', function(event, channel) {
    var extension = event.args[0];

    // Channels that we have dialed from within an SLA instance should not
    // spin up a new instance of the application.
    if (extension !== 'dialed') {
      var app = sla(client, confFilePath, channel, extension);

      app.run();
    }
  });
}

/**
 * Creates the ari connection and then registers a StasisStart listener for the
 *   sla application.
 * @param {String} confFilePath - File path for the configuration file.
 */
module.exports = function(confFilePath) {
  var connect = Q.denodeify(ari.connect);
  config = config.ari.client;

  connect(util.format(
    '%s://%s:%s',
    config.protocol,
    config.host,
    config.port
  ), config.credentials.user, config.credentials.password)
  .then(function (client) {
    clientLoaded(client, confFilePath);
  })
  .done();
};
