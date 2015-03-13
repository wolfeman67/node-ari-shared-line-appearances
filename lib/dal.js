var Q = require('q');
var fetchJSON = require('./fetchJSON.js');

/** Attempts to access configuration file data for the shared extension
 * @param {string} confFile - the path and filename to the configuration file
 * @param {string} name - the name of the sharedExtension to access
 * @return {Q} - Q promise object
 */

var getSharedExtension = function(confFile, name) {
  var defer = Q.defer();
  var sharedExtension = {};
  sharedExtension.found = false;
  return fetchJSON(confFile).then(function(data) {
    data.sharedExtensions.forEach(function(extension, i) {
      if(extension[name]) {
        sharedExtension.name = name;
        sharedExtension.getAllTrunks = getAllTrunks;
        sharedExtension.getTrunk = getTrunk;
        sharedExtension.trunks = extension[sharedExtension.name].trunks;
        sharedExtension.pos = i;
        sharedExtension.found = true;
        defer.resolve(sharedExtension);
      }
    });
    if (!sharedExtension.found) {
      defer.reject('Invalid specified extension: ' + name);
    }
    return defer.promise;
  });
};

/** Returns all trunks that are under a sharedExtension
 * @return {Q} - Q promise object
 */
var getAllTrunks = function() {
  return Q.resolve(this.trunks);
};

/** Attempts to return a specific trunk that is under the sharedExtension
 * param {string} trunkName - the name of the trunk to access
 * @return {Q} - Q promise object
 */
var getTrunk = function(trunkName) {
  var defer = Q.defer();
  var trunk = {};
  trunk.name = trunkName;
  trunk.found = false;
  this.trunks.forEach(function(element, i) {
    if(element[trunkName]) {
      trunk.getAllStations = getAllStations;
      trunk.trunkName = trunkName;
      trunk.stations = element[trunk.name].stations;
      trunk.pos = i;
      trunk.found = true;
      defer.resolve(trunk);
    }
  });
  if(trunk.found) {
    defer.reject('Invalid specified trunk: ' + trunkName);
  }
  return defer.promise;
};

  
/** Returns all stations that are under a trunk with trunkName.
 * @return {Q} - Q promise object
 */
var getAllStations = function() {
  return Q.resolve(this.stations);
};

module.exports = {
  getSharedExtension: getSharedExtension
};

