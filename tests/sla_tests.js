/**
 * SLA bridge and channel creation tests.
 *
 */
/*global describe:false*/
/*global afterEach:false*/
/*global it:false*/
'use strict';

var util = require('util');
var Emitter = require('events').EventEmitter;
var Q = require('q');

// What simulates the mock ARI client
var mockClient;
// The bridge id that gets incremented every time a bridge is created
var bridgeId = 0;
// The channel id that gets incremented every time a channel is created
var channelId = 0;
// The channels in existance
var channels = [];
// The bridges in existance (should only be one)
var bridges = [];
// The channels in the bridges
var bridgeChannels = [];
// Conditional for whether or not StasisStart has been passed yet
var pastStasis = false;
// Conditional for whether or not the created bridge is specified as mixing
var isMixing = false;
// Mocks a valid endpoint for originating
var validEndpoint = 'SIP/phone';
// Conditional for whether or not we are using an existing bridge
var usingExisting = false;

// The mocked up version of the callback error function
var errHandler = function(err) {
  throw new Error(err);
};

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
        cb(null, bridges);
        if(bridges.length !== 0) {
          usingExisting = true;
        }
        return bridges;
      },
      create: function(param, cb) {
        bridges.push(getMockBridge(param));
        cb(null, bridges[bridges.length-1]);
      }
    };
    this.Channel= function() {
      return getMockChannel();
    };
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
    this['bridge_type'] = param.type;
    if (this['bridge_type'] === 'mixing') {
      isMixing = true;
    }
    this.id = bridgeId.toString();
    bridgeId += 1;
    this.addChannel= function(input, cb) {
      //Here channels and bridges should have the same ID number
      var channel = channels.filter(function(testChan) {
        return testChan.id === input.channel;
      })[0];
      bridgeChannels.push(channel);
      cb(null);
      this.emit('ChannelEnteredBridge', {bridge: this.id,
        channel: channel.id}, {bridge: this, channel: channel});
    };
  };
  util.inherits(Bridge, Emitter);
  var mockBridge = new Bridge(param);
  return mockBridge;
};

/**
 * Returns a mock channel that has an id, and can use originate to add a channel
 * to the array of total channels. Emits a StasisStart event when originating.
 */

var getMockChannel = function() {
  var Channel = function() {
    this.id = channelId.toString();
    channelId += 1;
    this.originate = function(input, cb) {
      var self = this;
      setTimeout(function() {
        if(validEndpoint === input.endpoint) {
          self.emit('StasisStart', {channel: {id: self.id}}, {channel: self});
          pastStasis = true;
        }
      }, asyncDelay);
    };
  };
  util.inherits(Channel, Emitter);
  var mockChannel = new Channel();
  channels.push(mockChannel);
  return mockChannel;
};

describe('SLA Bridge and Channel Tester', function() {

  afterEach(function(done) {
    bridges = [];
    usingExisting = false;
    validEndpoint = 'SIP/phone';
    pastStasis = false;
    channels = [];
    bridgeChannels = [];
    isMixing = false;
    done();
  });

  it('should create a bridge when there isn\'t one', function(done) {
    var client = getMockClient();
    var sla = require('../lib/sla.js')(client).done();

    bridgeChecking();
    function bridgeChecking() {
      setTimeout(function() {
        if(channels.length !== 0 && !usingExisting && isMixing) {
          done();
        } else {
          bridgeChecking();
        }
      }, asyncDelay);
    } 
  });

  it('should use a preexisting bridge if there is one', function(done) {
    var client = getMockClient();
    var sla = require('../lib/sla.js')(client).done();

    bridges.push(getMockBridge({type: 'mixing'}, function(){}));
    bridgeChecking();
    function bridgeChecking() {
      setTimeout(function() {
        if(channels.length !== 0 && usingExisting && isMixing) {
          done();
        } else {
          bridgeChecking();
        }
      }, asyncDelay);
    } 
  });

  it('should use a "valid" endpoint and give off a StasisStart event ' +
     'to proceed to the next section', function(done) {
    var client = getMockClient();
    var sla = require('../lib/sla.js')(client).done();

    validChecking();
    function validChecking() {
      setTimeout(function() {
        if(pastStasis && bridgeChannels.length !== 0 &&
          isMixing === true) {
          done();
        } else {
          validChecking();
        }
      }, asyncDelay);
    } 
  });

  it('should use an "invalid" endpoint and not give off a StasisStart event',
     function(done) {
    validEndpoint = 'SIP/notphone';
    var client = getMockClient();
    var sla = require('../lib/sla.js')(client).done();

    invalidChecking();
    function invalidChecking() {
      setTimeout(function() {
        if(!pastStasis && bridgeChannels.length === 0 && isMixing) {
          done();
        } else {
          invalidChecking();
        }
      }, asyncDelay);
    } 
  });
});
