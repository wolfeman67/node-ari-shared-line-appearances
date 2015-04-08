'use strict';

var ari = require('ari-client');
var util = require('util');
var sla = require('./lib/sla.js');
var Q = require('q');
var dal = require('./lib/dal.js');

var connect = Q.denodeify(ari.connect);
var confFile;
if (confFile = process.argv[2]) {
  connect('http://localhost:8088', 'user', 'pass')
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

/** Utility function for seeing if an error is fatal (crashes the program)
 * @param {Object} err - the error in question.
 * @return {boolean} - if the error is fatal or not
 */
function isFatal(err) {
  return !(err.name === 'DialedHungup' || err.name === 'HangupFailure' ||
      err.name === 'NoStations' || err.name === 'InboundHungup' ||
      err.name === 'ExtensionBusy' || err.name === 'OutboundHungup' ||
      err.name === 'StationsHungup' || err.name === 'EarlyOutboundHungup' ||
      err.name === 'ExtensionOccupied');
}

/**
 * Handles errors found in application.
 * @param {Object} err - error from application.
 */
function errHandler(err) {
  if (!isFatal(err)) {
   console.log(err.message);
  } else {
   throw err;
  } 
}
