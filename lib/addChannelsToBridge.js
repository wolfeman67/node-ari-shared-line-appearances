var Q = require('q');
/**
 * Adds the caller channel and originated channel (if applicable) to the bridge.
 * @param {Object} client - the client (used for hanging up at the end).
 * @param {Object} channels - Array of channels to be added to the bridge.
 * @param {Object} bridge - Bridge that channels are to be added to.
 * @return {Q} Q promise object.
 */
function addChannelsToBridge(client, channels, bridge) {
  var extName = bridge.name;

  console.log('Adding channels to bridge %s', bridge.id);

  var addChannel = Q.denodeify(bridge.addChannel.bind(bridge));
  if (channels.length === 2) {
    addChannel({channel: [channels[0].id, channels[1].id]});
  } else {
    addChannel({channel: channels[0].id});
  }
  return;
}
module.exports = addChannelsToBridge;