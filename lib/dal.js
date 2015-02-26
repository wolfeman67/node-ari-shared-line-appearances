var fs = require('fs');
var Q = require('q');

//Reads from the configuration file.
function getConfig(confFile) {
  var defer = Q.defer();
  var readJSON = Q.denodeify(fs.readFile.bind(fs.readFile));
  readJSON(confFile, 'utf8')
    .then(function (data) {
      var JSONdata = JSON.parse(data);
      defer.resolve(JSONdata);
    })
    .catch(function (err) {
      defer.reject(err);
    });
  return defer.promise;
}

// Writes to the configuration file.
function writeConfig(confFile, newData) {
  var defer = Q.defer();
  console.log('HORSE');
  var writeJSON = Q.denodeify(fs.writeFile.bind(fs.writeFile));
  writeJSON(confFile, JSON.stringify(newData, null, 2), 'utf-8')
  .then(function() {
    console.log('bulls');
    var OK = true;
    defer.resolve(OK);
  })
  .catch(function (err) {
    console.log('GOOSE');
    console.log(err);
    defer.reject(err);
  });
  return defer.promise;
}

var getAllTrunks = function(confFile) {
};
  
// Returns all stations that are under a trunk with trunkName.
// Gives off an error if the trunk doesn't exist.
var getAllStations = function(confFile, trunkName) {
  var defer = Q.defer();
  var stations;
  getConfig(confFile).then(function(data) {
    data.trunks.forEach(function(trunk) {
      if (trunk.name === trunkName) {
        stations = trunk.stations;
      }
    });
    defer.resolve(stations);
  })
  .catch(function (err) {
    defer.reject(err);
  });
  return defer.promise;
};

var getStation = function(confFile, trunkName, endpoint) {
};

var updateTrunk = function(confFile, trunkName, newName) {
};

var updateStation = function(confFile, trunkName, endpoint, newEndpoint) {
};

// Creates a trunk with the given trunkName and appends it to the trunks array
var createTrunk = function(confFile, trunkName) {
  console.log('EGGPLANT');
  var defer = Q.defer();
  getConfig(confFile).then(function(data) {
    console.log('PORK');
    var newTrunk = {'name': trunkName, 'stations': []};
    data.trunks.push(newTrunk);
    console.log(data.trunks[0]);
    writeConfig(confFile, data).then(function() {
      defer.resolve(true);
    })
    .catch(function(err) {
      defer.reject(err);
    });
  })
  .catch(function(err) {
    defer.reject(err);
  });
};

// Adds a station under a trunk with name trunkName.
// Gives off an error if the trunk wasn't found.
var addStation = function(confFile, trunkName, endpoint) {
  var defer = Q.defer();
  getConfig(confFile).then(function(data) {
    findTrunk(confFile, trunkName, endpoint).then(function(trunkPosition) {
      if(trunkPosition === -1) {
        defer.reject('There is no trunk with this name ' + trunkName);
      } else {
        var newStation = {'endpoint': endpoint};
        data.trunks[trunkPosition].stations.push(newStation);
        writeConfig(confFile, data).then(function() {
          defer.resolve(true);
        })
        .catch(function(err) {
          defer.reject(err);
        });
      }
    })
    .catch(function(err) {
      defer.reject(err);
    });
  })
  .catch(function(err) {
    defer.reject(err);
  });
return defer.promise;
};

// Deletes a trunk with the name trunkName.
// Gives off an error if the trunk wasn't found.
var deleteTrunk = function(confFile, trunkName) {
  var defer = Q.defer();
  getConfig(confFile).then(function(data) {
    findTrunk(confFile, trunkName).then(function(trunkPosition) {
      if(trunkPosition === -1) {
        defer.reject('There is no trunk with this name ' + trunkName);
      } else {
        console.log('deleting trunk ' + data.trunks[0].name);
        console.log(trunkPosition);
        data.trunks.splice(trunkPosition, 1);
        console.log('deleted trunk ' + data.trunks);
        writeConfig(confFile, data).then(function() {
          defer.resolve(true);
        })
        .catch(function(err) {
          defer.reject(err);
        });
      }
    })
    .catch(function(err) {
      defer.reject(err);
    });
  })
  .catch(function(err) {
   defer.reject(err);
  });
};

// Deletes a station under the trunk with name trunkName.
// Gives off an error if the trunk wasn't found.
// Gives off another error if the station wasn't found.
var deleteStation = function(confFile, trunkName, endpoint) {
  var defer = Q.defer();
  getConfig(confFile).then(function(data) {
    findStation(confFile, trunkName, endpoint).then(function(positions) {
      var trunkPosition = positions.trunkPostion;
      var stationPosition = positions.stationPosition;
      if(trunkPosition === -1) {
        defer.reject('There is no trunk with this name ' + trunkName);
      } else if (stationPosition === -1) {
        defer.reject('There is no station with this endpoint ' + endpoint);
      } else {
        data.trunks[trunkPosition].stations.splice(stationPosition, 1);
        writeConfig(confFile, data).then(function() {
          defer.resolve(true);
        })
        .catch(function(err) {
          defer.reject(err);
        });
      }
    })
    .catch(function(err) {
      defer.reject(err);
    });
  })
  .catch(function(err) {
    defer.reject(err);
  });
  return defer.promise;
};

// Searches for the trunk and returns the position of it.
// Returns -1 if its postion wasn't found.
var findTrunk = function(confFile, trunkName) {
  var defer = Q.defer();
  getConfig(confFile).then(function(data) {
    var trunkPosition = -1;
    data.trunks.forEach(function(trunk, i) {
      if (trunk.name === trunkName) {
        trunkPosition = i;
      }
    });
    defer.resolve(trunkPosition);
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
        var stationPosition = -1;
        data[trunkPosition].stations.forEach(function (station, i) {
          if(station.endpoint === endpoint) {
            stationPosition = i;
          }
        });
        defer.resolve([trunkPosition, stationPosition]);
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

