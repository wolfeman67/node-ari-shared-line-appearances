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
var dal = require('../lib/dal.js');

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
// Mocks valid endpoints for originating
var validEndpoints = ['SIP/phone1', 'SIP/phone2', 'SIP/phone3', 'SIP/100@42-A'];
// Conditional for whether or not we are using an existing bridge
var usingExisting = false;
// The path and filename for the configuration
var config = 'tests/testConfigs/singleEndpoint.json';
// Whether or not reading the configuration file failed or not
var configurationFailed = false;
// Whether or not there are no endpoints in the configuration (application
// should fail out)
var noStations = false;
// Whether or not there are no trunks to use for outbound dialing (fails app)
var noTrunks = false;
// Conditional flag for whether or not the extension was attempted to be
// accessed from the outside while a call was in progress.
var extensionBusy = false;

// The mocked up version of the callback error function
var errHandler = function(err) {
  console.error(err);
  if (err.name === 'InvalidConfiguration') {
    configurationFailed = true;
  }
  if (err.name === 'NoTrunks') {
    noTrunks = true;
  }
  if (err.name === 'NoStations') {
    noStations = true;
  }
  if (err.name === 'ExtensionOccupied') {
    extensionBusy = true;
  }
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
  if (mockClient) {
    return mockClient;
  }
  var Client = function() {
    this.bridges = {
      list: function(cb) {
        cb(null, bridges);
        if (bridges.length !== 0) {
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
    this.channels = {
      hangup: function(object, cb) {
        channels.some(function(channel) {
          if (channel.id === object.channelId) {
            channel.hangup(function (){});
          }
        });
        cb(null);
      }
    };

    this.Playback = function() {
      var playback= {};
      return playback;
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
      var chanId = input.channel;
      var self = this;
      channels.forEach( function(testChan){
        if (testChan.id === input.channel) {
          bridgeChannels.push(testChan.id);
          self.emit('ChannelEnteredBridge', {bridge: self,
            channel: testChan}, {bridge: self, channel: testChan});
        }
      });
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
      this.caller = {'number': '13578'};
      this.name = 'dialed' + this.id;
      this.dialed = true;
      if (channels[0].outbound) {
        this.nonStation = true;
      }
      dialed.push(this);
      var self = this;
      if (this.id % 2 === 0) {
        answeringDelay = answeringDelay * 2;
      }
      setTimeout(function() {
        if (validEndpoints.indexOf(input.endpoint) !== -1) {
          if (channels.indexOf(self) !== -1) {
            self.emit('StasisStart', {channel: self}, self);
            cb(null);
          }
        }
        else {
          cb(new Error(self.id + ' is an invalid channel'));
        }
      }, answeringDelay);
    };
    this.hangup = function(cb) {
      var self = this;
      var channelFoundInBridges = false;
      this.wasHungup = true;
      setTimeout(function() {
        if (channels.length) {
          bridgeChannels = bridgeChannels.filter(function(channel) {
            if (channel === self.id) {
              channelFoundInBridges = true;
            }
            return channel !== self.id;  
          });
          if (channelFoundInBridges) {
            bridges[0].channels = bridgeChannels;
            bridges[0].emit('ChannelLeftBridge', {channel: self,
              bridge: bridges[0]}, {channel: self, bridge: bridges[0]});
          }
          channels = channels.filter(function(channel) {
            return channel !== self;
          });
          self.emit('ChannelHangupRequest', {channel: self}, self);
          self.emit('ChannelDestroyed', {channel: self}, self);
          cb(null);
        }
      }, (asyncDelay/2));
    };
    this.play = function(media, playbackObj) {
      return null;
    };
    this.answer = function(cb) {
      this.wasAnswered = true;
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
    validEndpoints = ['SIP/phone1', 'SIP/phone2', 'SIP/phone3', 'SIP/100@42-A'];
    channels = [];
    bridgeChannels = [];
    isMixing = false;
    answeringDelay = asyncDelay;
    dialed = [];
    configurationFailed = false;
    noStations = false;
    noTrunks = false;
    extensionBusy = false;
    config = 'tests/testConfigs/singleEndpoint.json';
    dal.purgeExtensions();
    done();
  });

  // All of these tests also test the functionality of the
  // configuration parsing, etc.
  it('should create a bridge when there isn\'t one', function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.name = 'SIP/phone3';
    channel.caller = {'number': '1234'};
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .done();

    bridgeChecking();
    function bridgeChecking() {
      setTimeout(function() {
        if (channels.length && !usingExisting && isMixing) {
          done();
        } else {
          bridgeChecking();
        }
      }, asyncDelay);
    } 
  });

  it('should use a preexisting bridge if there is one', function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.name = 'SIP/phone3';
    channel.caller = {'number': '1234'};
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .done();

    bridges.push(getMockBridge({type: 'mixing', name: '42'}, function(){}));
    bridgeChecking();
    function bridgeChecking() {
      setTimeout(function() {
        if (channels.length && usingExisting && isMixing) {
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
    var channel = getMockChannel();
    channel.name = 'SIP/phone3';
    channel.caller = {'number': '1234'};
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .done();

    validChecking();
    function validChecking() {
      setTimeout(function() {
        if (dialed[0] && dialed[0].wasAnswered && bridgeChannels.length !== 0 &&
          isMixing && channel.wasAnswered) {
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
    var channel = getMockChannel();
    channel.name = 'SIP/phone3';
    channel.caller = {'number': '1234'};
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();

    invalidChecking();
    function invalidChecking() {
      setTimeout(function() {
        if (dialed[0] && !dialed[0].wasAnswered &&
          bridgeChannels.length === 0 && isMixing && channel.wasAnswered) {
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
    var channel = getMockChannel();
    channel.name = 'SIP/phone3';
    channel.caller = {'number': '1234'};
    channel.inbound = true;
    var sla = require('../lib/sla.js')(client, config, channel, 'invalid')
      .catch(errHandler)
      .done();

    incorrectBridge();
    function incorrectBridge() {
      setTimeout(function() {
        if (bridges.length === 0 && !dialed[0] && channel.inbound &&
          !channel.wasAnswered && channel.wasHungup && channels.length === 0) {
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
    var channel = getMockChannel();
    channel.name = 'SIP/phone3';
    channel.caller = {'number': '1234'};
    channel.inbound = true;
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();
    answeringDelay = 2 * asyncDelay;
    channel.hangup(function(){});

    earlyHangup();
    function earlyHangup() {
      setTimeout(function() {
        if (isMixing && channels.length === 0 && bridges.length === 1 &&
          channel.inbound && channel.wasAnswered && channel.wasHungup &&
          dialed[0] && dialed[0].wasHungup && !dialed[0].wasAnswered) {
          done();
        } else {
          earlyHangup();
        }
      }, asyncDelay);
    } 
  });
  it('should hangup inbound channel if all dialed channles fail to answer',
      function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.name = 'SIP/phone3';
    channel.caller = {'number': '1234'};
    channel.inbound = true;
    config='tests/testConfigs/multipleEndpoints.json';
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();
    answeringDelay = 4 * asyncDelay;

    failToAnswer();
    setTimeout(function() {
      dialed[0].hangup(function() {});
      dialed[1].hangup(function() {});
    }, asyncDelay);
    function failToAnswer() {
      setTimeout(function() {
        if (isMixing && channels.length === 0 && bridges.length === 1 &&
          channel.inbound && channel.wasAnswered && dialed[0] &&
          dialed[1] && dialed[0].wasHungup && dialed[1].wasHungup && 
          channel.wasHungup) {
                done();
          } else {
            failToAnswer();
          }
      }, answeringDelay);
    }
  });
  it('should cancel the dialing of other channels if one dialed channel ' +
      'answers', function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.inbound= true;
    channel.name = 'SIP/phone3';
    channel.caller = {'number': '1234'};
    config='tests/testConfigs/multipleEndpoints.json';
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();

    invalidConfigurationFile();
    function invalidConfigurationFile() {
      setTimeout(function() {
        if (isMixing && channels.length === 2 && bridges.length === 1 &&
          channel.inbound && channel.wasAnswered && dialed[0] &&
          dialed[1]) {
            if ((dialed[0].wasHungup && dialed[1].wasAnswered) ||
              (dialed[1].wasHungup && dialed[0].wasAnswered)) {
                done();
              }
          } else {
            cancelDialing();
          }
      }, asyncDelay);
    } 
  });
  it('should give the application an invalid configuration file and promptly ' +
      'fail out', function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.name = 'SIP/phone3';
    channel.caller = {'number': '1234'};
    channel.inbound = true;
    config = 'tests/testConfigs/invalid.json';
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();

    invalidConfigurationFile();
    function invalidConfigurationFile() {
      setTimeout(function() {
        if (configurationFailed) {
          done();
        } else {
          invalidConfigurationFile();
        }
      }, asyncDelay);
    } 
  });
  it('should test the configuration when there are no endpoints and ' +
      'fail out', function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.name = 'SIP/phone3';
    channel.caller = {'number': '1234'};
    channel.inbound = true;
    config = 'tests/testConfigs/noEndpoints.json';
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();

    noEndpoints();
    function noEndpoints() {
      setTimeout(function() {
        if (noEndpoints) {
          done();
        } else {
          noEndpoints();
        }
      }, asyncDelay);
    } 
  });
  it('should test the configuration when there are no trunks to use and ' +
      'fail out', function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.name = 'SIP/phone1';
    channel.caller = {'number': '1234'};
    channel.outbound = true;
    config = 'tests/testConfigs/noTrunks.json';
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();

    notASingleTrunk();
    function notASingleTrunk() {
      setTimeout(function() {
        if (noTrunks) {
          done();
        } else {
          notASingleTrunk();
        }
      }, asyncDelay);
    } 
  });
  it('should test whether or not outbound dialing works nominally',
      function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.name = 'SIP/phone1';
    channel.caller = {'number': '1234'};
    channel.outbound = true;
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();
    var toDial =['1','0','0','#'];
    var index = 0;

    outboundNominal();
    function outboundNominal() {
      setTimeout(function() {
        if (channels.length === 2 && bridgeChannels.length === 2 &&
          channel.outbound && channel.wasAnswered && dialed[0].wasAnswered &&
          dialed[0].nonStation) {
          done();
        } else {
          channel.emit('ChannelDtmfReceived', {digit: toDial[index],
            channel: channel}, {channel: channel});
          index += 1;
          outboundNominal();
        }
      }, asyncDelay);
    } 
  });
  it('should test whether or not the application will fail when an incorrect' +
      'extension is specified', function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.name = 'SIP/phone1';
    channel.caller = {'number': '1234'};
    channel.outbound = true;
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();
    var toDial =['2','0','0','#'];
    var index = 0;

    outboundBadExtension();
    function outboundBadExtension() {
      setTimeout(function() {
        if (channels.length === 0 && bridgeChannels.length === 0 &&
          channel.outbound && channel.wasAnswered && !dialed[0].wasAnswered &&
          dialed[0].nonStation && dialed[0].wasHungup && channel.wasHungup) {
          done();
        } else {
          if(toDial[index]) {
            channel.emit('ChannelDtmfReceived', {digit: toDial[index],
              channel: channel}, {channel: channel});
            index += 1;
          }
          outboundBadExtension();
        }
      }, asyncDelay);
    } 
  });
  it('should test whether or not an additional station can join in a call' +
      ' in progress', function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.name = 'SIP/phone1';
    channel.caller = {'number': '1234'};
    channel.outbound = true;
    var secondChannel;
    var config = 'tests/testConfigs/multipleEndpoints.json';
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();
    var toDial =['1','0','0','#'];
    var index = 0;

    secondStationJoinsBridge();
    setTimeout(function () {
      secondChannel = getMockChannel();
      secondChannel.name = 'SIP/phone2';
      secondChannel.caller = {'number': '5678'};
      secondChannel.outbound = true;
      var sla2 = require('../lib/sla.js')(client, config, secondChannel, '42')
      .catch(errHandler)
      .done();
    }, asyncDelay * 7);
    function secondStationJoinsBridge() {
      setTimeout(function() {
        if (channels.length === 3 && bridgeChannels.length === 3 &&
          channel.outbound && channel.wasAnswered && secondChannel.outbound &&
          secondChannel.wasAnswered && dialed[0].wasAnswered &&
          dialed[0].nonStation) {
          done();
        } else {
          if(toDial[index]) {
            channel.emit('ChannelDtmfReceived', {digit: toDial[index],
              channel: channel}, {channel: channel});
            index += 1;
          }
          secondStationJoinsBridge();
        }
      }, asyncDelay);
    } 
  });
  it('should test whether or not an additional inbound caller gets kicked out' +
      ' when a call in progress', function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    validEndpoints = ['SIP/phone1', 'SIP/phone2', 'SIP/phone3', 'SIP/phone4'];
    channel.name = 'SIP/phone3';
    channel.caller = {'number': '1234'};
    channel.inbound = true;
    var secondChannel = getMockChannel();
    secondChannel.name = 'SIP/phone4';
    secondChannel.caller = {'number': '5678'};
    secondChannel.inbound = true;
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();

    additionalCallerRejected();
    setTimeout(function () {
      var sla2 = require('../lib/sla.js')(client, config, secondChannel, '42')
      .catch(errHandler)
      .done();
    }, asyncDelay * 2);
    function additionalCallerRejected() {
      setTimeout(function() {
        if (channels.length === 2 && bridgeChannels.length === 2 &&
          channel.inbound && channel.wasAnswered && !channel.wasHungup &&
          secondChannel.inbound && secondChannel.wasAnswered &&
          secondChannel.wasHungup && dialed[0].wasAnswered &&
          !dialed[0].nonStation && !dialed[0].wasHungup && extensionBusy) {
          done();
        } else {
          additionalCallerRejected();
        }
      }, asyncDelay);
    } 
  });
  it('should test whether or not the application hangs up a non-station ' +
      'channel when both station channels hang up', function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.name = 'SIP/phone1';
    channel.caller = {'number': '1234'};
    channel.outbound = true;
    var secondChannel;
    var config = 'tests/testConfigs/multipleEndpoints.json';
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();
    var toDial =['1','0','0','#'];
    var index = 0;
    var hangupRequested = false;

    bothStationsHangup();
    setTimeout(function () {
      secondChannel = getMockChannel();
      secondChannel.name = 'SIP/phone2';
      secondChannel.caller = {'number': '5678'};
      secondChannel.outbound = true;
      var sla2 = require('../lib/sla.js')(client, config, secondChannel, '42')
      .catch(errHandler)
      .done();
    }, asyncDelay * 7);
    function bothStationsHangup() {
      setTimeout(function() {
        if (channels.length === 0 && bridgeChannels.length === 0 &&
          channel.outbound && channel.wasAnswered && channel.wasHungup &&
          secondChannel.outbound && secondChannel.wasAnswered && 
          secondChannel.wasHungup && dialed[0].wasAnswered &&
          dialed[0].nonStation && dialed[0].wasHungup) {
          done();
        } else {
          if(toDial[index]) {
            channel.emit('ChannelDtmfReceived', {digit: toDial[index],
              channel: channel}, {channel: channel});
            index += 1;
          }
          if (secondChannel && channel && bridgeChannels.length === 3 &&
            !hangupRequested) {
              hangupRequested = true;
            channel.hangup(function (){});
            secondChannel.hangup(function (){});
          }
          bothStationsHangup();
        }
      }, asyncDelay);
    } 
  });
  it('should test whether the application keeps the non-station channel with ' +
      'a station, when only one station hangs up', function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.name = 'SIP/phone1';
    channel.caller = {'number': '1234'};
    channel.outbound = true;
    var secondChannel;
    var config = 'tests/testConfigs/multipleEndpoints.json';
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();
    var toDial =['1','0','0','#'];
    var index = 0;
    var hangupRequested = false;

    oneStationHangsup();
    setTimeout(function () {
      secondChannel = getMockChannel();
      secondChannel.name = 'SIP/phone2';
      secondChannel.caller = {'number': '5678'};
      secondChannel.outbound = true;
      var sla2 = require('../lib/sla.js')(client, config, secondChannel, '42')
      .catch(errHandler)
      .done();
    }, asyncDelay * 7);
    function oneStationHangsup() {
      setTimeout(function() {
        if (channels.length === 2 && bridgeChannels.length === 2 &&
          channel.outbound && channel.wasAnswered && channel.wasHungup &&
          secondChannel.outbound && secondChannel.wasAnswered && 
          !secondChannel.wasHungup && dialed[0].wasAnswered &&
          dialed[0].nonStation && !dialed[0].wasHungup) {
          done();
        } else {
          if(toDial[index]) {
            channel.emit('ChannelDtmfReceived', {digit: toDial[index],
              channel: channel}, {channel: channel});
            index += 1;
          }
          if (secondChannel && channel && bridgeChannels.length === 3 &&
            !hangupRequested) {
              hangupRequested = true;
            channel.hangup(function (){});
          }
          oneStationHangsup();
        }
      }, asyncDelay);
    } 
  });
  it('should hangup both station channels when the outside channel hangs up',
      function(done) {
    var client = getMockClient();
    var channel = getMockChannel();
    channel.name = 'SIP/phone1';
    channel.caller = {'number': '1234'};
    channel.outbound = true;
    var secondChannel;
    var config = 'tests/testConfigs/multipleEndpoints.json';
    var sla = require('../lib/sla.js')(client, config, channel, '42')
      .catch(errHandler)
      .done();
    var toDial =['1','0','0','#'];
    var index = 0;
    var hangupRequested = false;

    nonStationHangsup();
    setTimeout(function () {
      secondChannel = getMockChannel();
      secondChannel.name = 'SIP/phone2';
      secondChannel.caller = {'number': '5678'};
      secondChannel.outbound = true;
      var sla2 = require('../lib/sla.js')(client, config, secondChannel, '42')
      .catch(errHandler)
      .done();
    }, asyncDelay * 7);
    function nonStationHangsup() {
      setTimeout(function() {
        if (channels.length === 0 && bridgeChannels.length === 0 &&
          channel.outbound && channel.wasAnswered && channel.wasHungup &&
          secondChannel.outbound && secondChannel.wasAnswered && 
          secondChannel.wasHungup && dialed[0].wasAnswered &&
          dialed[0].nonStation && dialed[0].wasHungup) {
          done();
        } else {
          if(toDial[index]) {
            channel.emit('ChannelDtmfReceived', {digit: toDial[index],
              channel: channel}, {channel: channel});
            index += 1;
          }
          if (secondChannel && channel && bridgeChannels.length === 3 &&
            !hangupRequested) {
              hangupRequested = true;
            dialed[0].hangup(function() {});
          }
          nonStationHangsup();
        }
      }, asyncDelay);
    } 
  });
});
