'use strict';

var ari = require('ari-client');
var util = require('util');
var sla = require('./lib/sla.js');

ari.connect('http://127.0.0.1:8088', 'ariUser', 'boogers', clientLoaded);

function clientLoaded (err, client){
    console.log(sla());}
