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
    if(!isDialed(event.args[0])) {
      var extension = event.args[0];
      var confFile = process.argv[2];
      sla(client, channel, confFile, extension)
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
  if(err.name === 'EarlyHangup' || err.name === 'HangupFailure' ||
    err.name === 'NoStations') {
   console.log(err.message);
  } else {
   throw err;
  } 
}
