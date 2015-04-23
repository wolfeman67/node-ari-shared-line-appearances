var Q = require('q');

/**
 * Accesses the current state of the shared extension.
 * @param {Object} client - Object that contains information from the ARI
 *   connection. Houses the device states
 * @param {String} name - name of the shared extension to access.
 * @return {String} - the current device state of this extension
 */
function getState(client, name) {
  var getDeviceState = Q.denodeify(client.deviceStates.get.bind(client
        .deviceStates));
  return getDeviceState({deviceName: 'Stasis:' + name}).then(function (ds) {
    return ds.state;
  });
}

module.exports = getState;