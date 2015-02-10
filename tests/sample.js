/**
 * SLA bridge and channel creation tests.
 *
 */
"use strict";

/*global describe:false*/
/*global afterEach:false*/

var util = require('util');
var Emitter = require('events').EventEmitter;

var mockClient;
var mockChannel;
var mockBridge;
// The channels in existance
var channels = [];
// The bridges in existance (should only be one)
var bridges = [];
// The channels in the bridges
var bridge_channels = [];
// Tests if a bridge has been created or not on a particular test. Resets
var bridge_created = 0;
// Mock value for whether the endpoint is valid or not
var valid = 1;
// Conditional for whether or not StasisStart has been passed yet
var pastStasis = 0;

// The mocked up version of the callback error function
var end= function(err){console.log(err);}

// Millesecond delay for mock requests
var asyncDelay = 100;

/**
 * Returns a mock client that houses the bridges and can create both bridges
 * and channels.
 */

var getMockClient = function() {
  if(mockClient) {
    return mockClient;
  }
  var Client = function() {
    this.bridges = {
      list: function(cb) {
        console.log(bridges);
        cb(null, bridges);
        return bridges;
      },
      create: function(param, cb) {
        bridge_created = 1;
        console.log(param);
        bridges.push(getMockBridge(param));
        console.log(bridges)
        cb(null, bridges[0]);
      }
    };
    this.Channel= function() {
      return getMockChannel();
      }
  };
  mockClient = new Client();
  return mockClient;
};

/**
 * Returns a mock bridge that has a bridge_type and id, and can add channels
 * to its array of channels. Emits a ChannelEnteredBridge event
 */

var getMockBridge = function(param) {
  var Bridge = function(param) {
    console.log(param.type);
    this.bridge_type = param.type;
    this.id = "1";
    this.addChannel= function(input, cb) {
      console.log("TREX");
      pastStasis = 1;
      var channel = channels.filter(function(testChan) {
        return testChan.id === '1';
      })[0];
      bridge_channels.push(channel);
      cb(null);
      console.log(channel);
      this.emit('ChannelEnteredBridge', {channel: {id: channel.id}});
    };
  };
  util.inherits(Bridge, Emitter);
  mockBridge = new Bridge(param);
  return mockBridge;
};

/**
 * Returns a mock channel that has an id, and can use originate to add a channel
 * to the array of total channels. Emits a StasisStart event when originating.
 */

var getMockChannel = function() {
  var Channel = function() {
    this.id = '1';
    this.originate = function(input, cb) {
      console.log(input);
      var self = this;
      setTimeout(function() {
        if(valid == 1) {
          console.log(self);
          self.emit('StasisStart', self, self);
        }
      }, 20);
    };
  };
  util.inherits(Channel, Emitter);
  mockChannel = new Channel();
  channels.push(mockChannel);
  return mockChannel;
};

describe('SLA Bridge and Channel Tester', function() {

  afterEach(function(done) {
    channels = [];
    bridge_channels = [];
    bridge_created = 0;
    done();
    });

  it('should create a bridge when there isn\'t one', function(done) {
    var channel = getMockChannel();
    var client = getMockClient();
    var sla = require('../lib/sla.js')(client, end);

    bridgeChecking();
    function bridgeChecking() {
      setTimeout(function() {
        if(channels.length != 0 && bridge_created == 1) {
          done();
        } else {
          bridgeChecking();
        }
      }, asyncDelay);
    } 
  });

  it('should use a preexisting bridge if there is one', function(done) {
    var channel = getMockChannel();
    var client = getMockClient();
    var sla = require('../lib/sla.js')(client, end);

    bridgeChecking();
    function bridgeChecking() {
      setTimeout(function() {
        if(channels.length != 0 && bridge_created == 0) {
          done();
        } else {
          bridgeChecking();
        }
      }, asyncDelay);
    } 
  });

  it('should use a "valid" endpoint and give off a StasisStart event ' +
     'to proceed to the next section', function(done) {
    var channel = getMockChannel();
    var client = getMockClient();
    var sla = require('../lib/sla.js')(client, end);

    validChecking();
    function validChecking() {
      setTimeout(function() {
        if(pastStasis == 1 && bridge_channels.length != 0) {
          pastStasis = 0;
          done();
        } else {
          validChecking();
        }
      }, asyncDelay);
    } 
  });

  it('should use an "invalid" endpoint and not give off a StasisStart event',
     function(done) {
    valid = 0;
    var channel = getMockChannel();
    var client = getMockClient();
    var sla = require('../lib/sla.js')(client, end);

    invalidChecking();
    function invalidChecking() {
      setTimeout(function() {
        if(pastStasis == 0 && bridge_channels.length == 0) {
          done();
        } else {
          invalidChecking();
        }
      }, asyncDelay);
    } 
  });
});
