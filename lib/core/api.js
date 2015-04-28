'use strict';

var dal = require('../data/dal.js');

function buildApi(data, channel) {
  return {
    run: function() {
      // get or create bridge, originate...
    }
  };
}

module.exports.build = function(confFile, channel, extensionName) {
  return dal.getData(confFile, channel, extensionName)
    .then(function(data) {
      return buildApi(data, channel);
    });
};
