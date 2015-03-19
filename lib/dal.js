var Q = require('q');
var fetchJSON = require('./fetchJSON.js');

var extsInUse = [];

/** 
 * Attempts to access configuration file data for the shared extension
 * @param {string} confFile - the path and filename to the configuration file
 * @param {string} name - the name of the sharedExtension to access
 * @return {Q} - Q promise object
 */

var getSharedExtension = function(confFile, name) {
  var defer = Q.defer();
  var sharedExtension = {};
  console.log('GENGAR');
  foundInUsed = false;
  // This is done in order to conserve the states of the trunks of the same
  // extension being called.
  extsInUse.forEach(function(ext) {
    if (ext.name === name) {
      console.log('Using previously utilized extension');
      foundInUsed = true;
      defer.resolve(ext);
      return defer.promise;
    }
  });
  if (!foundInUsed) {
    console.log('ALAMO');
    sharedExtension.found = false;
    return fetchJSON(confFile).then(function(data) {
      data.sharedExtensions.forEach(function(extension, i) {
        if (extension[name]) {
          sharedExtension.name = name;
          sharedExtension.getAllTrunks = getAllTrunks;
          sharedExtension.getAllStations = getAllStations;
          sharedExtension.getTrunk = getTrunk;
          sharedExtension.trunks = extension[sharedExtension.name].trunks;
          sharedExtension.stations = extension[sharedExtension.name].stations;
          sharedExtension.pos = i;
          sharedExtension.found = true;
          defer.resolve(sharedExtension);
        }
      });
      if (!sharedExtension.found) {
        defer.reject('Invalid specified extension: ' + name);
      }
      extsInUse.push(sharedExtension);
    });
  }
  return defer.promise;
};

var clearSharedExtension = function(name) {
  extsInUse.forEach(function (ext, index) {
    if (ext.name === name) {
      extsInUse.splice(index, 1);
      return Q.resolve(null);
    }
  });
  return Q.reject('Attempted to clear extension that wasn\'t in use');
};

var makeBusy = function() {
  this.busy = true;
  return Q.resolve(null);
};

var makeAvailable = function() {
  delete this.busy;
  return Q.resolve(null);
};

var setUser = function(endpoint) {
  this.user = endpoint;
  return Q.resolve(null);
};

var clearUser = function() {
  delete this.user;
  return Q.resolve(null);
};

/** 
 * Returns all trunks that are under a sharedExtension
 * @return {Q} - Q promise object
 */
var getAllTrunks = function() {
  var trunkData = [];
  this.trunks.forEach(function(trunk, i) {
    var trunkElement = {};
    trunkElement.name = Object.keys(trunk)[0];
    trunkElement.getAllStations = getAllStations;
    trunkElement.makeBusy = makeBusy;
    trunkElement.makeAvailable = makeAvailable;
    trunkElement.setUser = setUser;
    trunkElement.clearUser = clearUser;
    trunkElement.stations = trunk[trunkElement.name].stations;
    trunkData.push(trunkElement);
  });
  return Q.resolve(trunkData);
};

/** 
 * Attempts to return a specific trunk that is under the sharedExtension
 * param {string} trunkName - the name of the trunk to access
 * @return {Q} - Q promise object
 */
var getTrunk = function(trunkName) {
  var defer = Q.defer();
  var trunk = {};

  trunk.name = trunkName;
  trunk.found = false;
  this.trunks.forEach(function(element, i) {
    if (element[trunkName]) {
      trunk.getAllStations = getAllStations;
      trunk.stations = element[trunk.name].stations;
      trunk.pos = i;
      trunk.found = true;
      defer.resolve(trunk);
    }
  });
  if (!trunk.found) {
    defer.reject('Invalid specified trunk: ' + trunkName);
  }
  return defer.promise;
};

  
/** 
 * Returns all stations that are under a trunk with trunkName.
 * @return {Q} - Q promise object
 */
var getAllStations = function() {
  return Q.resolve(this.stations);
};

module.exports = {
  getSharedExtension: getSharedExtension,
  clearSharedExtension: clearSharedExtension
};

