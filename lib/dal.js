var fs = require('fs');
var Q = require('q');

//Reads from the configuration file.
function getConfig(confFile) {
  var readJSON = Q.denodeify(fs.readFile.bind(fs.readFile));
  return readJSON(confFile, 'utf8')
    .then(function (data) {
      var JSONdata = JSON.parse(data);
      return Q.resolve(JSONdata);
    });
}

// Writes to the configuration file.
function writeConfig(confFile, newData) {
  var writeJSON = Q.denodeify(fs.writeFile.bind(fs.writeFile));
  return writeJSON(confFile, JSON.stringify(newData, null, 2), 'utf-8')
  .then(function() {
    var OK = true;
    return Q.resolve(OK);
  });
}

var getAllTrunks = function(confFile) {
};
  
// Returns all stations that are under a trunk with trunkName.
// Gives off an error if the trunk doesn't exist.
var getAllStations = function(confFile, trunkName) {
  var defer = Q.defer();
  var stations;
  return getConfig(confFile).then(function(data) {
    data.trunks.forEach(function(trunk) {
      if (trunk.name === trunkName) {
        stations = trunk.stations;
      }
    });
    defer.resolve(stations);
    return defer.promise;
  });
};

var getStation = function(confFile, trunkName, endpoint) {
};

var updateTrunk = function(confFile, trunkName, newName) {
};

var updateStation = function(confFile, trunkName, endpoint, newEndpoint) {
};

// Creates a trunk with the given trunkName and appends it to the trunks array
var createTrunk = function(confFile, trunkName) {
  return getConfig(confFile).then(function(data) {
    var newTrunk = {'name': trunkName, 'stations': []};
    data.trunks.push(newTrunk);
    return writeConfig(confFile, data);
  });
};

// Adds a station under a trunk with name trunkName.
// Gives off an error if the trunk wasn't found.
var addStation = function(confFile, trunkName, endpoint) {
  return getConfig(confFile).then(function(data) {
    return findTrunk(confFile, trunkName, endpoint).then(
      function(trunkPosition) {
        if(trunkPosition === -1) {
          return Q.reject('There is no trunk with this name ' + trunkName);
      } else {
        var newStation = {'endpoint': endpoint};
        data.trunks[trunkPosition].stations.push(newStation);
        return writeConfig(confFile, data);
      }
    });
  });
};

// Deletes a trunk with the name trunkName.
// Gives off an error if the trunk wasn't found.
var deleteTrunk = function(confFile, trunkName) {
  return getConfig(confFile).then(function(data) {
    return findTrunk(confFile, trunkName).then(function(trunkPosition) {
      if(trunkPosition === -1) {
        return Q.reject('There is no trunk with this name ' + trunkName);
      } else {
        data.trunks.splice(trunkPosition, 1);
        return writeConfig(confFile, data);
      }
    });
  });
};

// Deletes a station under the trunk with name trunkName.
// Gives off an error if the trunk wasn't found.
// Gives off another error if the station wasn't found.
var deleteStation = function(confFile, trunkName, endpoint) {
  return getConfig(confFile).then(function(data) {
    return findStation(confFile, trunkName, endpoint).then(function(positions) {
      var trunkPosition = positions.trunkPostion;
      var stationPosition = positions.stationPosition;
      if(trunkPosition === -1) {
        return Q.reject('There is no trunk with this name ' + trunkName);
      } else if (stationPosition === -1) {
        return Q.reject('There is no station with this endpoint ' + endpoint);
      } else {
        data.trunks[trunkPosition].stations.splice(stationPosition, 1);
        return writeConfig(confFile, data);
      }
    });
  });
};

// Searches for the trunk and returns the position of it.
// Returns -1 if its postion wasn't found.
var findTrunk = function(confFile, trunkName) {
  var defer = Q.defer();
  getConfig(confFile).then(function(data) {
    data.trunks.forEach(function(trunk, i) {
      if (trunk.name === trunkName) {
        defer.resolve(i);
      }
      else if(i === (data.trunks.length - 1)) {
        defer.resolve(-1);
      }
    });
  })
  .catch(function (err) {
    defer.reject(err);
  });
  return defer.promise;
};

// Searches for the station and returns the position of its under the trunk
// Also returns the trunk position of the trunk that houses it.
// Returns -1 for both if either haven't been found
var findStation = function(confFile, trunkName, endpoint) {
  var defer = Q.defer();
  getConfig(confFile).then(function(data) {
    findTrunk(confFile, trunkName).then(function(trunkPosition) {
      if(trunkPosition !== -1) {
        data[trunkPosition].stations.forEach(function (station, i, stations) {
          if(station.endpoint === endpoint) {
            defer.resolve([trunkPosition, i]);
          }
          else if (i === stations.length - 1) {
            defer.resolve([trunkPosition, -1]);
          }
        });
      } else {
        defer.resolve([-1, -1]);
      }
    })
    .catch(function (err) {
      defer.reject(err);
    });
  })
  .catch(function (err) {
    defer.reject(err);
  });
};



// Half of these functions for now will be skeletons for future tasks.
// Right now, I'm only fully fleshing out the one's that are required.
// Mainly because what I am using may not be the most "correct" way for an API.
module.exports = {
  getAllTrunks: getAllTrunks,
  getAllStations: getAllStations,
  getStation: getStation,
  updateTrunk: updateTrunk,
  updateStation: updateStation,
  deleteTrunk: deleteTrunk,
  deleteStation: deleteStation,
  createTrunk: createTrunk,
  addStation: addStation,
  findTrunk: findTrunk,
  findStation: findStation
};

