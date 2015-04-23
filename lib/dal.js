var Q = require('q');
var fetchJSON = require('./fetchJSON.js');
var customError = require('./customError.js');

/**
 * Attempts to access configuration file data for the shared extension
 *   Creates a new sharedExtension "object" and its relevant underlying data
 *   structures and returns it.
 * @param {string} confFile - the path and filename to the configuration file
 * @param {string} name - the name of the sharedExtension to access
 * @return {Q} - Q promise object
 */
var getSharedExtension = function(confFile, name) {
  var sharedExtension = {};
  sharedExtension.found = false;

  return fetchJSON(confFile).then(function(data) {
    for (var index = 0; index < data.sharedExtensions.length; index++) {
      var extension = data.sharedExtensions[index];

      if (extension[name]) {
        sharedExtension.stations = extension[name].stations;
        sharedExtension.trunks = extension[name].trunks;
        if (extension[name].timeout) {
          sharedExtension.timeout = extension[name].timeout;
        } else {
          sharedExtension.timeout = '10';
        }
        sharedExtension.found = true;
        break;
      }
    }
    if (!sharedExtension.found) {
      throw new customError.CustomError('InvalidExtension',
          'Invalid specified extension: ' + name);
    } else if (!sharedExtension.stations.length){
      throw new customError.CustomError('NoStations',
        'No stations in this sharedExtension');
    } else if (!sharedExtension.trunks.length) {
      throw new customError.CustomError('NoTrunks',
        'There are no trunks with which to outbound dial');
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