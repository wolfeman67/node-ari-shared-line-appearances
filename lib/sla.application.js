'use strict';

var dal = require('./data/dal.js');
var stateMachine = require('./core/stateMachine.js');

function buildApp(client, data, channel) {
  var state = stateMachine.create(client, data, channel);

  return {
    run: function() {
      state.init();
    }
  };
}

module.exports = function(client, confFilePath, channel, extension) {
  var data = dal.getData(confFilePath, channel, extension);

  return buildApp(client, data, channel);
};
