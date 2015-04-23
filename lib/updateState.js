var Q = require('q');

/**
 * Updates the state of the shared extension.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {String} name - name of the shared extension to update.
 * @param {String} state - state to update the shared extension to.
 */
function updateState(client, name, state) {
  var deviceState = Q.denodeify(client.deviceStates.update.bind(client));
  return deviceState({deviceName: 'Stasis:' + name, deviceState: state});
}

module.exports = updateState;