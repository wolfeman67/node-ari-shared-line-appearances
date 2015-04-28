'use strict';

var bootstrap = require('./lib/sla.bootstrap.js');

var confFilePath = process.argv[2];

if (!confFilePath) {
  throw new Error('No configuration file specified');
}

bootstrap(confFilePath);
