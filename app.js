/*jslint node: true */  
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
 * Starts Stasis app 'sla' and initiates SLA application after ARI connection.
 * @param {Object} client - Object that contains information from the ARI 
 *   connection.
 */
function clientLoaded (client) {
  client.start('sla');
  sla(client)
    .then(console.log)
    .catch(errHandler)
    .done();
}

/**
 * Handles errors found in application.
 * @param {Object} err - error from application.
 */
function errHandler(err) {
  console.error(err);
  throw err;
}
