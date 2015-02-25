var fs = require('fs');
var fileName = './res/config.json';
var Q = require('q');

function getConfig() {
  var defer = Q.defer();
  var readJSON = Q.denodeify(fs.readFile.bind(fs.readFile));
  readJSON(fileName, 'utf8')
    .then(function (data) {
      var JSONdata = JSON.parse(data);
      defer.resolve(JSONdata);
    })
    .catch(function (err) {
      defer.reject(err);
    });
  return defer.promise;
}

function writeConfig() {
}



// A majority of these functions for now will be skeletons for future tasks.
// Right now, I'm only fully fleshing out the one's that are required.
// Mainly because what I am using may not be the most "correct" way for an API.
module.exports = {
  getAllTrunks: function() {
  },
  getAllStations: function(name) {
    var defer = Q.defer();
    var stations;
    getConfig().then(function(data) {
      data.trunks.forEach(function(trunk) {
        if (trunk.name === name) {
          stations = trunk.stations;
        }
      });
      console.log(stations); 
      defer.resolve(stations);
    })
    .catch(function (err) {
      defer.reject(err);
    });
    return defer.promise;
  },
  getStation: function(name, endpoint) {
  },
  updateTrunk: function(name, newName) {
  },
  updateStation: function(trunkName, endpoint, newEndpoint) {
  },
  createTrunk: function(name) {
  },
  addStation: function(name, endpoint) {
  },
  deleteTrunk: function(name) {
  },
  deleteStation: function(name, endpoint) {
  },
  findTrunk: function(name) {
    var defer = Q.defer();
    getConfig().then(function(data) {
      var trunkExists = false;
      data.trunks.forEach(function(trunk) {
        if (trunk.name === name) {
          trunkExists = true;
        }
      });
      defer.resolve(trunkExists);
    })
    .catch(function (err) {
      defer.reject(err);
    });
    return defer.promise;
  },
  findStation: function(name, endpoint) {
  }
};

