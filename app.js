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
  client.start('sla');
  sla(client, function(err) {
    if (err != null) {
      console.error(err);
      process.exit(1);
    } else {
      console.log('Application Completed');
      process.exit(0);
    }
  });
};
