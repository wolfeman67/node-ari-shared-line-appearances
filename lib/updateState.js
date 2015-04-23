var Q = require('q');

/**
 * Updates the state of the shared extension.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {Object} extsInUse - Object that represents what extensions are
 * currently in use by this application
 * @param {String} name - name of the shared extension to update.
 * @param {String} state - state to update the shared extension to.
 */
var updateState = function(client, extsInUse, name, state) {
  extsInUse[name].currentState = state;
  var deviceState = Q.denodeify(client.deviceStates.update.bind(client));
  return deviceState({deviceName: 'Stasis:' + name, deviceState: state});
}

module.exports =  updateState;