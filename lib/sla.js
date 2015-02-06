'use strict';

module.exports = function(client, channel, callback){
  var playback = client.Playback();
  joinHoldingBridge(channel);

  function joinHoldingBridge(channel) {
    client.bridges.list(function(err, bridges) {
      var bridge = bridges.filter(function(candidate) {
        return candidate.bridge_type === 'mixing';
      })[0];
      if (bridge) {
        console.log('Using existing mixing bridge %s', bridge.id);
        createChannel(err, client, bridge);
      }
      else {
        bridge = client.bridges.create({type: 'mixing'}, function(err, bridge) {
          if (err) {
            console.error(err);
          }
          else {
            console.log('Created new mixing bridge %s', bridge.id);
            createChannel(err, client, bridge);
          }
        });
      }
    });
  }
  function addChannelsToBridge(channel, acbridge) {
    console.log('Adding channel to bridge %s', acbridge.id);
    acbridge.addChannel({channel: channel.id}, function(err) {
      if (err) {
        console.error(err);
      }
    });
    acbridge.on('ChannelEnteredBridge', function(event, objects) {
      console.log("Channel %s has entered the bridge", objects.bridge.channels[0]);
    });
  }
  function createChannel(err, client, ccbridge) {
    var channel = client.Channel();
    channel.originate(
      {endpoint: 'SIP/phone', app: 'hello'},
      function(err, channel, ccbridge) {
        if (err) {
          console.error(err);
        }
      }
    );
    channel.on('StasisStart', function(event, outgoing){
      addChannelsToBridge(outgoing, ccbridge);
    });
  }
}
