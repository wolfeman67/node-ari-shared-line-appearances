'use strict';

var dal = require('./data/dal.js');
var stateMachine = require('./core/stateMachine.js');

/**
 * Builds the application and then initiates the state machine.
 * @param {Object} client - Asterisk ARI client instance
 * @param {Object} data - the data {trunks, stations, etc.) related to this
 *   extension.
 * @param {Object} channel - The object that represents the incoming channel
 *   that has just entered Stasis.
 */
function buildApp(client, data, channel) {
  var state = stateMachine.create(client, data, channel);

  return {
    run: function() {
      state.init();
    }
  };
}

/**
 * Retrieves the data from the DAL file and passes it to buildApp.
 * @param {Object} client - Asterisk ARI client instance
 * @param {String} confFilePath - File path for the configuration file.
 * @param {Object} channel - The incoming channel.
 * @param {String} extension - The name of the extension to access.
 */
module.exports = function(client, confFilePath, channel, extension) {
  var data = dal.getData(confFilePath, channel, extension);

  return buildApp(client, data, channel);
};
