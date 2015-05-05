var util = require('util');
var Q = require('q');
var regexp = require('node-regexp');

var customError = require('../util/customError.js');

/**
 * Attempts to access configuration file data for the shared extension
 *   and returns it if it exists.
 * @param {string} confFilePath - Path and filename to the configuration file.
 * @param {string} name - The name of the sharedExtension to access.
 * @return {Object} - Shared extension object.
 */
var getSharedExtension = function(confFilePath, name) {
  var sharedExtension = {};
  var data = require(util.format('../../%s', confFilePath));

  for (var index = 0; index < data.sharedExtensions.length; index++) {
    var extension = data.sharedExtensions[index];

    if (extension[name]) {
      sharedExtension.name = name;
      sharedExtension.stations = extension[sharedExtension.name].stations;
      sharedExtension.trunks = extension[sharedExtension.name].trunks;

      break;
    }
  }

  if (!sharedExtension.trunks || !sharedExtension.stations) {
    throw new customError.CustomError('InvalidExtension',
        'Invalid specified extension: ' + name);
  }

  return sharedExtension;
};

/**
 * Utility function for checking if a channel is a member of an extension.
 * @param {String} extension - The extension in question.
 * @param {String} channel - The channel in question.
 * @return {Boolean} - Returns true if it is a station, false if it is not.
 */
function isStation (extension, channel) {
  var stations = extension.stations;
  for (var index = 0; index < stations.length; index++) {
    var station = stations[index];
    var re = regexp().find(station).toRegExp();

    // First conditional is for regular SIP users like SIP/phone1
    if (re.test(channel.name)) {
    	return true;
    } else {

      // Second conditional is for other SIP users that have a different
      // server like SIP/phone2@1234
      var nameDivided = channel.name.split('/');
      if (re.test(nameDivided[0] + '/' + channel.caller.number + '@' +
          nameDivided[1])) {
            return true;
          }
    }
  }
  return false;
}

/**
 * Returns all relevant data for the extension to be used in module.exports.
 * @param {String} confFile - The configuration path and file name.
 * @param {Object} channel - The inbound or outbound channel.
 * @param {String} extensionName - The name of the extension to access.
 */
function getData(confFile, channel, extensionName) {
  var data = {};

  var sharedExtension = getSharedExtension(confFile, extensionName);

  data.extension = sharedExtension;
  data.isStation = isStation(data.extension, channel);

  return data;
}

module.exports = {
  getData: getData
};
