var Q = require('q');

/**
 * Looks for an existing mixing bridge and creates one if none exist.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {String} bridgeName - the name of the bridge to be created/designated
 * @return {Q} Q promise object.
 */
function designateMixingBridge(client, bridgeName) {
  var defer = Q.defer();
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
          defer.resolve(bridge);
        } else {
          var create = Q.denodeify(client.bridges.create.bind(client));
          create({type: 'mixing', name: bridgeName})
            .then(function(bridge) {
              console.log('Created new mixing bridge %s numbered %s',
                bridge.id, bridge.name);
              defer.resolve(bridge);
            });
        }
      })
    .catch(function (err) {
      defer.reject(err);
    });
  return defer.promise;
}

module.exports = designateMixingBridge;