var dal = require('./dal.js');

/**
 * Returns all relevant data for the extension to be used in module.exports
 * @param {string} confFile - the configuration path and file name
 * @param {Object} channel - the inbound or outbound channel
 * @param {string} extensionName - the name of the extension to access
 */
function build(confFile, channel, extensionName) {
  var data = {};
  return dal.getSharedExtension(confFile, extensionName)
    .then(function(result) {
      data.extension = result;
      data.isStation = isStation(data.extension, channel);
      return data;
    });
}
