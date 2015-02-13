'use strict';
var Q = require('q');

/**
 * Looks for an existing mixing bridge and creates one if none exist.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @return {Q} Q promise object.
 */
function designateMixingBridge(client) {
  var defer = Q.defer();
  var list = Q.denodeify(client.bridges.list.bind(client));
  list().then(
      function(bridges) {
        var bridge = bridges.filter(function(candidate) {
          return candidate['bridge_type'] === 'mixing';
        })[0];
        if (bridge) {
          console.log('Using existing mixing bridge %s', bridge.id);
          defer.resolve(bridge);
        } else {
          var create = Q.denodeify(client.bridges.create.bind(client));
          create({type: 'mixing'})
            .then(function(bridge) {
              console.log('Created new mixing bridge %s', bridge.id);
              defer.resolve(bridge);
            });
        }
      })
    .catch(function (err) {
      defer.reject(err);
    });
  return defer.promise;
}

/**
 * Adds created channel to the bridge.
 * @param {Object} channel - Created channel to be added to the bridge.
 * @param {Object} bridge - Bridge that channel is to be added to.
 * @return {Q} Q promise object.
 */
function addChannelsToBridge(channel, bridge) {
  var defer = Q.defer();
  console.log('Adding channel to bridge %s', bridge.id);
  var addChannel = Q.denodeify(bridge.addChannel.bind(bridge));
  addChannel({channel: channel.id})
    .catch(function (err) {
      defer.reject(err);
    });
  bridge.once('ChannelEnteredBridge', function(event, bridge) {
    console.log('Channel %s has entered the bridge', bridge.channel.id);
  });
  bridge.once('ChannelLeftBridge', function(event, bridge) {
    console.log('Channel %s has left the bridge', bridge.channel.id);
    defer.resolve('Application completed');
  });
  return defer.promise;
}

/**
 * Creates a channel to a specified endpoint and places it in the Stasis app.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {Object} bridge - Object that defines the bridge to be passed to
 *   addChannelsToBridge().
 * @return {Q} Q promise object.
 */
function createChannel(client, bridge) {
  var defer = Q.defer();
  var channel = client.Channel();
  var originate = Q.denodeify(channel.originate.bind(channel));
  originate({endpoint: 'SIP/phone', app: 'sla'})
    .catch(function (err) {
      defer.reject(err);
    });
  channel.once('StasisStart', function(event, channel) {
    defer.resolve(channel);
  });
  return defer.promise;
}

/**
 * Receives initial input and begins the application.
 * @param {Object} client - Client received from app.js.
 * @return {Q} Q promise object.
 */
module.exports = function(client) {
  return designateMixingBridge(client)
    .then(function (bridge) {
      return createChannel(client, bridge)
        .then(function (channel) {
          return addChannelsToBridge(channel, bridge);
        });
    });
};
