var Q = require('q');
var fetchJSON = require('./fetchJSON.js');
var customError = require('./customError.js');
var extsInUse = [];

/** 
 * Attempts to access configuration file data for the shared extension
 *   If this is the first time accessing this said extension, then it creates
 *   a new sharedExtension "object" and its relevant underlying data structures,
 *   adds it to the array of extsInUse and returns it.
 *   Simply returns the object in extsInUse if already previously created. This
 *   is done so that the busy data of the trunk will be used when 
 *   getSharedExtension is called by another user when a call is in session.
 * @param {string} confFile - the path and filename to the configuration file
 * @param {string} name - the name of the sharedExtension to access
 * @return {Q} - Q promise object
 */

var getSharedExtension = function(confFile, name) {
  var defer = Q.defer();
  var sharedExtension = {};
  var foundInUsed = false;
  // This is done in order to conserve the states of the trunks of the same
  // extension being called.
  extsInUse.forEach(function(ext) {
    if (ext.name === name) {
      foundInUsed = true;
      defer.resolve(ext);
    }
  });
  if (!foundInUsed) {
    sharedExtension.found = false;
    fetchJSON(confFile).then(function(data) {
      data.sharedExtensions.some(function(extension, i) {
        if (extension[name]) {
          sharedExtension.name = name;
          sharedExtension.busy = false;
          sharedExtension.getAllTrunks = getAllTrunks;
          sharedExtension.getAllStations = getAllStations;
          sharedExtension.getTrunk = getTrunk;
          sharedExtension.stations = extension[sharedExtension.name].stations;
          sharedExtension.trunks = extension[sharedExtension.name].trunks;
          sharedExtension.pos = i;
          sharedExtension.makeBusy = makeBusy;
          sharedExtension.makeAvailable = makeAvailable;
          sharedExtension.found = true;
        }
      });
      if (!sharedExtension.found) {
        defer.reject(new customError.CustomError('InvalidExtension',
            'Invalid specified extension: ' + name));
      } else {
        defer.resolve(sharedExtension);
      }
    })
    .catch(function (err) {
      defer.reject(new customError.CustomError('InvalidConfiguration',
          err.message));
    });
  }
  return defer.promise;
};
/**
 * Makes this extension busy and pushes this extension to the array of
 * extensions in use
 */
var makeBusy = function() {
  extsInUse.push(this);
  this.busy = true;
  return Q.resolve(null);
};

/**
 * Makes this extension not busy anymore and removes it from the array of
 * extensions in use
 */
var makeAvailable = function() {
  extsInUse.forEach(function (ext, index) {
    if (ext.name === this.name) {
      extsInUse.splice(index, 1);
      return Q.resolve(null);
    }
  });
  this.busy = false;
  return Q.resolve(null);
};

/**
 * Empties out the extsInUse array. Should ONLY be used in tests because
 * hangups don't occur naturally there
 */
var purgeExtensions = function() {
  extsInUse = [];
};

/** 
 * Returns all trunks that are under a sharedExtension
 * @return {Q} - Q promise object
 */
var getAllTrunks = function() {
  return Q.resolve(this.trunks);
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
      trunk.trunkName = trunkName;
      trunk.stations = element[trunk.name].stations;
      trunk.pos = i;
      trunk.found = true;
      defer.resolve(trunk);
    }
  });
  if (trunk.found) {
    defer.reject('Invalid specified trunk: ' + trunkName);
  }
  return defer.promise;
};

  
/** 
 * Returns all stations that are under a sharedExtension
 * @return {Q} - Q promise object
 */
var getAllStations = function() {
  return Q.resolve(this.stations);
};

module.exports = {
  getSharedExtension: getSharedExtension,
  purgeExtensions: purgeExtensions
};

