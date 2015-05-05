var Q = require('q');

/**
 * Exports logic for creating a new bridge or reusing an existing bridge.
 * @param {Object} opts - Contains the data for the client and the bridge name.
 */
module.exports = function (opts) {
  var self = this;

  var client = opts.client;
  var bridgeName = opts.data.extension.name;

  var list = Q.denodeify(client.bridges.list.bind(client));

  list().then(
      function(bridges) {
        var bridge = bridges.filter(function(candidate) {
          return (candidate['bridge_type'] === 'mixing' &&
            candidate.name === bridgeName);
        })[0];

        if (bridge) {
          console.log('Using existing mixing bridge %s numbered %s',
            bridge.id, bridge.name);

          self.bridgeLoaded(bridge);
        } else {
          var create = Q.denodeify(client.bridges.create.bind(client));

          create({type: 'mixing', name: bridgeName})
            .then(function(bridge) {
              console.log('Created new mixing bridge %s numbered %s',
                bridge.id, bridge.name);

              self.bridgeLoaded(bridge);
            });
        }
      })
    .done();
};
