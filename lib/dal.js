var Q = require('q');
var fetchJSON = require('./fetchJSON.js');
var customError = require('./customError.js');

var extsInUse = [];

/**                                                                              
 * Represents an error that has both a name and message.
 * @param {String} name - the name/type of the error
 * @param {String} message - the corresponding message
 * Mainly used to avoid crashing the program, as it does with regular errors.
 */
function CustomError(name, message) {
  this.name = name;
  this.message = message;
}

/** 
 * Attempts to access configuration file data for the shared extension
 *   If this is the first time accessing this said extension, then it creates
 *   a new sharedExtension "object" and its relevant underlying data structures,
 *   adds it to the array of extsInUse and returns it.
 *   Simply returns the object in extsInUse if already previously created. This
 *   is done so that the relevant user and busy data of the trunks can be reused
 *   between instances of this application.
 *   extsInUse gets freed up when all trunks under a sharedExtension have been
 *   freed.
 * @param {string} confFile - the path and filename to the configuration file
 * @param {string} name - the name of the sharedExtension to access
 * @return {Q} - Q promise object
 */

var getSharedExtension = function(confFile, name) {
  var defer = Q.defer();
  var sharedExtension = {};
  foundInUsed = false;
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
          sharedExtension.getAllTrunks = getAllTrunks;
          sharedExtension.getAllStations = getAllStations;
          sharedExtension.getTrunk = getTrunk;
          sharedExtension.stations = extension[sharedExtension.name].stations;
          sharedExtension.pos = i;
          sharedExtension.makeBusy = makeBusy;
          sharedExtension.makeAvailable = makeAvailable;
          sharedExtension.found = true;
          sharedExtension.trunkData = [];
          extension[sharedExtension.name].trunks.forEach(function(trunk, i) {
          
            var trunkElement = {};
            trunkElement.name = Object.keys(trunk)[0];
            trunkElement.getAllStations = getAllStations;
            trunkElement.makeBusy = makeBusy;
            trunkElement.makeAvailable = makeAvailable;
            trunkElement.setUser = setUser;
            trunkElement.clearUser = clearUser;
            trunkElement.stations = trunk[trunkElement.name].stations;
            sharedExtension.trunkData.push(trunkElement);
          });
          extsInUse.push(sharedExtension);
          return true;
        }
      });
      if (!sharedExtension.found) {
        defer.reject('InvalidExtension',
            'Invalid specified extension: ' + name);
      } else {
        defer.resolve(sharedExtension);
      }
    });
    if (!sharedExtension.found) {
      defer.reject(new customError.CustomError('InvalidSpecification',
          'Invalid specified extension ' + sharedExtension.name));
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
  return Q.resolve(this.trunkData);
};

/** 
 * Attempts to return a specific trunk that is under the sharedExtension
 * param {string} trunkName - the name of the trunk to access
 * @return {Q} - Q promise object
 */
var getTrunk = function(trunkName) {
  var defer = Q.defer();
  this.trunks.forEach(function(element, i) {
    if (element[trunkName]) {
      defer.resolve(element);
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

