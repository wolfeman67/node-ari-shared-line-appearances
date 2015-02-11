'use strict';

var ari = require('ari-client');
var util = require('util');
var sla = require('./lib/sla.js');

ari.connect('http://127.0.0.1:8088', 'user', 'pass', clientLoaded);

function clientLoaded (err, client){
  client.start('hello');
  var outgoing = client.Channel();
  sla(client, outgoing, function(){
    console.log('done');
  });
}
