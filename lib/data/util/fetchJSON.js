var fs = require('fs');
var Q = require('q');

/**
 * Reads from the configuration file and returns data
 * @param {string} confFile - the path and filename to the configuration file
 * @return {Q} - Q promise object
 */
module.exports = function(confFile) {
  var readJSON = Q.denodeify(fs.readFile.bind(fs.readFile));
  return readJSON(confFile, 'utf8')
    .then(function (data) {
      var JSONdata = JSON.parse(data);
      return Q.resolve(JSONdata);
    });
};
