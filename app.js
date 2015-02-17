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
  var defer = Q.defer();
  client.on('StasisStart', function(event, channel) {
    stasisStart(event, client, channel);
  });
}

function stasisStart (event, client, channel) {
  if(event.args[0] !== 'dialed') {
    var bridgeNumber = event.args[0];
    sla(client, channel, bridgeNumber)
      .then(console.log)
      .catch(errHandler)
      .done();
  }
}

/**
 * Handles errors found in application.
 * @param {Object} err - error from application.
 */
function errHandler(err) {
  throw err;
}
