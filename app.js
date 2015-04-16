'use strict';

var ari = require('ari-client');
var sla = require('./lib/sla.js');
var errHandler = require('./lib/errHandler.js');
var Q = require('q');

var connect = Q.denodeify(ari.connect);
var confFile;
if (confFile = process.argv[2]) {
  connect('http://127.0.0.1:8088', 'user', 'pass')
    .then(clientLoaded)
    .catch(errHandler)
    .done();
} else {
  throw new Error('No configuration file specified');
}

/**
 * Checks if the argument tied to the StasisStart event is dialed (not inbound)
 * @param {String} argument - The argument (either an extension # or dialed)
 */
function isDialed(argument) {
  return argument === 'dialed';
}

/**
 * Waits for a StasisStart event before going into the main SLA module
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 */
function clientLoaded (client) {
  client.start('sla');
  client.on('StasisStart', function(event, channel) {
    if (!isDialed(event.args[0])) {
      var extension = event.args[0];
      var confFile = process.argv[2];
      sla(client, confFile, channel, extension)
        .then(console.log)
        .catch(errHandler)
        .done();
    }
  });
}