var Q = require('q');
var fetchJSON = require('./fetchJSON.js');
var customError = require('./customError.js');

/**
 * Attempts to access configuration file data for the shared extension
 *   and returns it if it exists.
 * @param {string} confFile - the path and filename to the configuration file
 * @param {string} name - the name of the sharedExtension to access
 * @return {Q} - Q promise object
 */

var getSharedExtension = function(confFile, name) {
  var sharedExtension = {};

  return fetchJSON(confFile).then(function(data) {
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
    } else {
      return sharedExtension;
    }
  })
  .catch(function (err) {
    throw new customError.CustomError('InvalidConfiguration',
        err.message);
  });
};

module.exports = {
  getSharedExtension: getSharedExtension
};