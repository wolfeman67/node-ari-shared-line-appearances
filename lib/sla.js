/*jslint node: true */
'use strict'

/**
 * Looks for an existing mixing bridge and creates one if none exist.
 */
function designateMixingBridge(client, callback) {
  client.bridges.list(function(err, bridges) {
    var bridge = bridges.filter(function(candidate) {
      return candidate.bridge_type === 'mixing';
    })[0];
    if (bridge) {
      console.log('Using existing mixing bridge %s', bridge.id);
      createChannel(client, bridge, callback);
    } else {
      client.bridges.create({type: 'mixing'}, function(err, bridge) {
        if (err) {
          callback(err);
        }
        console.log('Created new mixing bridge %s', bridge.id);
        createChannel(client, bridge, callback);
      });
    }
  });
}

/**
 * Adds created channel to the bridge.
 * @param {Object} channel - Created channel to be added to the bridge.
 * @param {Object} bridge - Bridge that channel is to be added to.
 */
function addChannelsToBridge(channel, bridge, callback) {
  console.log('Adding channel to bridge %s', bridge.id);
  bridge.addChannel({channel: channel.id}, function(err) {
    if (err) {
      channel.hangup();
      callback(err);
    }
  });
  bridge.once('ChannelEnteredBridge', function(event) {
    console.log("Channel %s has entered the bridge", event.channel.id);
  });
  bridge.once('ChannelLeftBridge', function(event) {
    console.log("Channel %s has left the bridge", event.channel.id);
    callback(null);
  });
}

/**
 * Creates a channel to a specified endpoint and places it in the Stasis app.
 * @param {Object} client - Object that contains information from the ARI
 *   connection.
 * @param {Object} bridge - Object that defines the bridge to be passed to
 *   addChannelsToBridge().
 */
function createChannel(client, bridge, callback) {
  var channel = client.Channel();
  channel.originate({endpoint: 'SIP/phone', app: 'sla'},
    function(err) {
      if (err) {
        callback(err);
      }
    }
  );
  channel.once('StasisStart', function(event) {
    addChannelsToBridge(event.channel, bridge, callback);
  });
}

/**                                                                              
 * Receives initial input and begins the application.                            
 * @param {Object} client - Client received from app.js.                         
 * @callback callback - Handles errors and ends the application.                      
 */ 
module.exports = function(client, callback) {                                         
  designateMixingBridge(client, callback);
};
