var Q = require('q');
/**
 * Adds the caller channel and originated channel (if applicable) to the bridge.
 * @param {Object} client - the client (used for hanging up at the end).
 * @param {Object} channel - Incoming channel to be added to the bridge.
 * @param {Object} dialed - Created/dialed channel to be added as well
 * @param {Object} bridge - Bridge that channels are to be added to.
 * @return {Q} Q promise object.
 */
function addChannelsToBridge(client, channel, dialed, bridge) {
  console.log('Adding channels to bridge %s', bridge.id);

  var addChannel = Q.denodeify(bridge.addChannel.bind(bridge));
  addChannel({channel: channel.id})
    .catch(function (err) {
      throw err;
    });

  if (dialed) {
    addChannel({channel: dialed.id})
      .catch(function (err) {
        throw err;
      });
  }
  return;
}
module.exports = addChannelsToBridge;