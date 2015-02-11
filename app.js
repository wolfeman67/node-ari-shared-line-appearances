/*jslint node: true */  
'use strict';

var ari = require('ari-client');
var util = require('util');
var sla = require('./lib/sla.js');

ari.connect('http://127.0.0.1:8088', 'user', 'pass', clientLoaded);

/**
 * Starts Stasis app 'sla' and initiates SLA application after ARI connection.
 * @param {Object} err - Error message.
 * @param {Object} client - Object that contains information from the ARI 
 *   connection.
 */
function clientLoaded (err, client) {
  if (err) {
    throw err;
  }
  client.start('sla');
  sla(client, function(err) {
    if (err !== null) {
      throw err;
    } else {
      console.log('Application Completed');
      process.exit(0);
    }
  });
}
