'use strict';

var ari = require('ari-client');
var util = require('util');
var sla = require('./lib/sla.js');
var Q = require('q');

var connect = Q.denodeify(ari.connect);

connect('http://127.0.0.1:8088', 'user', 'pass')
  .then(clientLoaded)
  .catch(errHandler)
  .done();

/**
 * Waits for a StasisStart event before going into the main SLA module
 * @param {Object} client - Object that contains information from the ARI 
 *   connection.
 */
function clientLoaded (client) {
  client.start('sla');
  client.on('StasisStart', function(event, channel) {
    if(event.args[0] !== 'dialed') {
      var bridgeName = event.args[0];
      sla(client, channel, bridgeName)
        .then(console.log)
        .catch(errHandler)
        .done();
    }
  });
}

/**
 * Handles errors found in application.
 * @param {Object} err - error from application.
 */
function errHandler(err) {
  throw err;
}
