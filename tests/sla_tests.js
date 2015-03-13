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
// Contains a list of all channels that have been dialed
// Note: They can be hung up afterwards, this isn't a current list like channels
var dialed = [];
// The bridges in existance (should only be one)
var bridges = [];
// The channels in the bridges
var bridgeChannels = [];
// Conditional for whether or not the created bridge is specified as mixing
var isMixing = false;
// Mocks a valid endpoint for originating
var validEndpoints = ['SIP/phone1', 'SIP/phone2'];
// Conditional for whether or not we are using an existing bridge
var usingExisting = false;

// The mocked up version of the callback error function
var errHandler = function(err) {
  console.error(err);
};

// Millesecond delay for mock requests
var asyncDelay = 100;
// The delay of answering (important for StasisStart events)
var answeringDelay = asyncDelay;

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
      var newChan = getMockChannel();
      return newChan;
    };
  };
  util.inherits(Client, Emitter);
  mockClient = new Client();
  return mockClient;
};

/**
 * Returns a mock bridge that has a bridge_type and id, and can add channels
 * to its array of channels. Emits a ChannelEnteredBridge event for every 
 * channel that enters it.
 */

var getMockBridge = function(param) {
  var Bridge = function(param) {
    this['bridge_type'] = param.type;
    this.name = param.name;
    if (this['bridge_type'] === 'mixing') {
      isMixing = true;
    }
    this.id = bridgeId.toString();
    bridgeId += 1;
    this.addChannel = function(input, cb) {
      channels.forEach( function(testChan){
        input.channel.forEach(function(inputChannel){
          if (testChan.id === inputChannel) {
            bridgeChannels.push(testChan);
          }
        });
      });
      if(bridgeChannels) {
        var self = this;
        bridgeChannels.forEach(function(bridgeChan) {
          self.emit('ChannelEnteredBridge', {bridge: self,
            channel: bridgeChan}, {bridge: self, channel: bridgeChan});
        });
      }
      cb(null);
    };
  };
  util.inherits(Bridge, Emitter);
  var mockBridge = new Bridge(param);
  return mockBridge;
};

/**
 * Returns a mock channel that has an id, and can use originate to add a channel
 * to the array of total channels. Emits a StasisStart event when originating.
 * Emits ChannelHangupRequest and ChannelDestroyed events when hanging up.
 */

var getMockChannel = function() {
  var Channel = function() {
    this.id = channelId.toString();
    channelId += 1;
    this.originate = function(input, cb) {
      this.dialed = true;
      dialed.push(this);
      var self = this;
      if(this.id % 2 === 0) {
        answeringDelay = answeringDelay * 2;
      }
      setTimeout(function() {
        if(validEndpoints.indexOf(input.endpoint) > -1) {
          self.emit('StasisStart', {channel: self}, self);
          cb(null);
        }
        else {
          cb(new Error(self.id + ' is an invalid channel'));
        }
      }, answeringDelay);
    };
    this.hangup = function(cb) {
      var self = this;
      this.hungup = true;
      setTimeout(function() {
        if(channels.length) {
          channels = channels.filter(function(channel) {
            return channel !== self;
          });
          self.emit('ChannelHangupRequest', {channel: self}, self);
          self.emit('ChannelDestroyed', {channel: self}, self);
          cb(null);
        }
      }, (asyncDelay/2));
    };
    this.answer = function(cb) {
      this.answered = true;
      cb(null);
    };
  };
  util.inherits(Channel, Emitter);
  var mockChannel = new Channel();
  channels.push(mockChannel);
  return mockChannel;
};

describe('SLA Bridge and Channels Tester', function() {

  afterEach(function(done) {
    bridges = [];
    usingExisting = false;
    validEndpoints = ['SIP/phone1', 'SIP/phone2'];
    channels = [];
    bridgeChannels = [];
    isMixing = false;
    answeringDelay = asyncDelay;
    dialed = [];
    done();
  });

  it('should create a bridge when there isn\'t one', function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    var sla = require('../lib/sla.js')(client, inbound, '999').done();

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
    var inbound = getMockChannel();
    var sla = require('../lib/sla.js')(client, inbound, '999').done();

    bridges.push(getMockBridge({type: 'mixing', name: '999'}, function(){}));
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
    var inbound = getMockChannel();
    var sla = require('../lib/sla.js')(client, inbound, '999').done();

    validChecking();
    function validChecking() {
      setTimeout(function() {
        if(dialed[0] && dialed[0].answered && bridgeChannels.length !== 0 &&
          isMixing && inbound.answered) {
          done();
        } else {
          validChecking();
        }
      }, asyncDelay);
    } 
  });

  it('should dial an "invalid" endpoint and not give off a StasisStart event',
     function(done) {
    validEndpoints = ['SIP/notphone'];
    var client = getMockClient();
    var inbound = getMockChannel();
    var sla = require('../lib/sla.js')(client, inbound, '999')
      .catch(errHandler)
      .done();

    invalidChecking();
    function invalidChecking() {
      setTimeout(function() {
        if(dialed[0] && !dialed[0].answered && bridgeChannels.length === 0 &&
          isMixing && inbound.answered) {
          done();
        } else {
          invalidChecking();
        }
      }, asyncDelay);
    } 
  });
  it('should enter the application but specify an invalid SLA bridge. The ' +
      'inbound channel should be hung up before being answered by the app.',
     function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound.inbound = true;
    var sla = require('../lib/sla.js')(client, inbound, 'invalid')
      .catch(errHandler)
      .done();

    incorrectBridge();
    function incorrectBridge() {
      setTimeout(function() {
        if(bridges.length === 0 && !dialed[0] && inbound.inbound &&
          !inbound.answered && inbound.hungup && channels.length === 0) {
            done();
        } else {
          incorrectBridge();
        }
      }, asyncDelay);
    } 
  });
  it('should enter the application, call the dialed channel, but hang up ' + 
      'before it answers (which in turn hangs up inbound caller)',
     function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound.inbound = true;
    var sla = require('../lib/sla.js')(client, inbound, '999')
      .catch(errHandler)
      .done();
    answeringDelay = 2 * asyncDelay;
    inbound.hangup(function(){});

    earlyHangup();
    function earlyHangup() {
      setTimeout(function() {
        if(isMixing && channels.length === 0 && bridges.length === 1 &&
          inbound.inbound && inbound.answered && inbound.hungup &&
          dialed[0] && dialed[0].hungup && !dialed[0].answered) {
          done();
        } else {
          earlyHangup();
        }
      }, asyncDelay);
    } 
  });
  it('should cancel the dialing of other channels if one dialed channel ' +
      'answers', function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound.inbound = true;
    var sla = require('../lib/sla.js')(client, inbound, '999')
      .catch(errHandler)
      .done();

    cancelDialing();
    function cancelDialing() {
      setTimeout(function() {
        if(isMixing && channels.length === 2 && bridges.length === 1 &&
          inbound.inbound && inbound.answered && dialed[0] &&
          dialed[1]) {
            if((dialed[0].hungup && dialed[1].answered) ||
              (dialed[1].hungup && dialed[0].answered)) {
                done();
              }
          } else {
            cancelDialing();
          }
      }, asyncDelay);
    }
  });
  it('should hangup inbound channel if all dialed channles fail to answer',
      function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound.inbound = true;
    var sla = require('../lib/sla.js')(client, inbound, '999')
      .catch(errHandler)
      .done();
    answeringDelay = 2 * asyncDelay;

    failToAnswer();
    setTimeout(function() {
      dialed[0].hangup(function() {});
      dialed[1].hangup(function() {});
    }, asyncDelay);
    function failToAnswer() {
      setTimeout(function() {
        if(isMixing && channels.length === 0 && bridges.length === 1 &&
          inbound.inbound && inbound.answered && dialed[0] &&
          dialed[1] && dialed[0].hungup && dialed[1].hungup && 
          inbound.hungup) {
                done();
          } else {
            failToAnswer();
          }
      }, answeringDelay);
    }
  });
});
