'use strict';

var dal = require('./data/dal.js');
var stateMachine = require('./core/stateMachine.js');

var STATE_MACHINES = {};

function buildApp(client, data, channel) {
	var state;
	var extension = data.extension.name;

	if (STATE_MACHINES[extension]) {
		state = STATE_MACHINES[extension];

		return {
			run: function() {
				state.init(channel, data);
			}
		};
	}

  state = stateMachine(client);
  STATE_MACHINES[extension] = state;

  return {
    run: function() {
      state.init(channel, data);
    }
  };
}

module.exports = function(client, confFilePath, channel, extension) {
  var data = dal.getData(confFilePath, channel, extension);

  return buildApp(client, data, channel);
};
