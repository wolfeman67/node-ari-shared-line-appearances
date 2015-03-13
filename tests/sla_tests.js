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
// Mocks a valid endpoint for originating
var validEndpoints = ['SIP/phone1', 'SIP/phone2'];
// Conditional for whether or not we are using an existing bridge
var usingExisting = false;
// The path and filename for the configuration
var config = 'tests/testConfigs/singleEndpoint.json';
// The extension (not the trunk) for all test instances to latch onto
var extension= 'leExtension';
// Whether or not reading the configuration file failed or not
var configurationFailed = false;
// Whether or not there are no endpoints in the configuration (application
// should fail out)
var noStations = false;
// Array containing device states
var mockDeviceStates = [];
// Device state object
var ds = {};

// The mocked up version of the callback error function
var errHandler = function(err) {
  console.error(err);
  if (err.name === 'InvalidConfiguration') {
    configurationFailed = true;
  }
  if (err.name === 'NoStations') {
    noStations = true;
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
    this.deviceStates = {
      update: function(param, cb) {
        //console.log('APPLE ' + JSON.stringify(mockDeviceStates));
        var exists = mockDeviceStates.filter(function(deviceState) {
          //console.log('MOO ');
          return deviceState.deviceName === param.deviceName;
        });
        if (!exists.length) {
          ds = {deviceName: param.deviceName, 
            deviceState: param.deviceState, hasBeenInUse: false};
          if(ds.deviceState === 'NOT_INUSE') {
            ds.isIdle = true;
          }
          mockDeviceStates.push(ds);
        } else {
          mockDeviceStates.forEach(function(ds) {
            if (ds.deviceName === param.deviceName) {
              if (param.deviceState === 'INUSE') {
                //console.log('GAJAH MADA');
                ds.hasBeenInUse = true;
              }
              if (param.deviceState === 'NOT_INUSE') {
                ds.isIdle = true;
              }
              if (param.deviceState === 'RINGING') {
                ds.hasRung = true;
                ds.isIdle = false;
              }
              ds.deviceState = param.deviceState;
            }
          });
        }
        cb(null);
      }
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
      if (bridgeChannels) {
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
      if (this.id % 2 === 0) {
        answeringDelay = answeringDelay * 2;
      }
      var self = this;
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
      this.wasHungup = true;
      setTimeout(function() {
        if (channels.length) {
          channels = channels.filter(function(channel) {
            return channel !== self;
          });
          cb(null);
          self.emit('ChannelHangupRequest', {channel: self}, self);
          self.emit('ChannelDestroyed', {channel: self}, self);
          cb(null);
        }
      }, (asyncDelay/2));
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
    validEndpoints = ['SIP/phone1', 'SIP/phone2'];
    channels = [];
    bridgeChannels = [];
    isMixing = false;
    answeringDelay = asyncDelay;
    dialed = [];
    configurationFailed = false;
    noStations = false;
    config = 'tests/testConfigs/singleEndpoint.json';
    mockDeviceStates = [];
    ds = {};
    done();
  });

  // All of these tests also test the functionality of the
  // configuration parsing, etc.
  it('should create a bridge when there isn\'t one', function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    var sla = require('../lib/sla.js')(client, config, inbound, '42')
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
    var inbound = getMockChannel();
    var sla = require('../lib/sla.js')(client, config, inbound, '42')
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
    var inbound = getMockChannel();
    var sla = require('../lib/sla.js')(client, config, inbound, '42')
      .done();

    validChecking();
    function validChecking() {
      setTimeout(function() {
        if (dialed[0] && dialed[0].wasAnswered && bridgeChannels.length !== 0 &&
          isMixing && inbound.wasAnswered) {
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
    var sla = require('../lib/sla.js')(client, config, inbound, '42')
      .catch(errHandler)
      .done();

    invalidChecking();
    function invalidChecking() {
      setTimeout(function() {
        if (dialed[0] && !dialed[0].wasAnswered &&
          bridgeChannels.length === 0 && isMixing && inbound.wasAnswered) {
          done();
        } else {
          invalidChecking();
        }
      }, asyncDelay);
    } 
  });
  it('should enter the application but specify an invalid SLA bridge. The ' +
      'inbound channel should be hung up before being.wasAnswered by the app.',
     function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound.inbound = true;
    var sla = require('../lib/sla.js')(client, config, inbound, 'invalid')
      .catch(errHandler)
      .done();

    incorrectBridge();
    function incorrectBridge() {
      setTimeout(function() {
        if (bridges.length === 0 && !dialed[0] && inbound.inbound &&
          !inbound.wasAnswered && inbound.wasHungup && channels.length === 0) {
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
    var sla = require('../lib/sla.js')(client, config, inbound, '42')
      .catch(errHandler)
      .done();
    answeringDelay = 4 * asyncDelay;
    inbound.hangup(function(){});

    earlyHangup();
    function earlyHangup() {
      setTimeout(function() {
        if (isMixing && channels.length === 0 && bridges.length === 1 &&
          inbound.inbound && inbound.wasAnswered && inbound.wasHungup &&
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
    var inbound = getMockChannel();
    inbound['inbound'] = 'yes';
    config='tests/testConfigs/multipleEndpoints.json';
    var sla = require('../lib/sla.js')(client, config, inbound, '42')
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
        if(isMixing && channels.length === 0 && bridges.length === 1 &&
          inbound.inbound && inbound.wasAnswered && dialed[0] &&
          dialed[1] && dialed[0].wasHungup && dialed[1].wasHungup && 
          inbound.wasHungup) {
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
    var inbound = getMockChannel();
    inbound.inbound= true;
    config='tests/testConfigs/multipleEndpoints.json';
    var sla = require('../lib/sla.js')(client, config, inbound, '42')
      .catch(errHandler)
      .done();

    cancelDialing();
    function cancelDialing() {
      setTimeout(function() {
        if (isMixing && channels.length === 2 && bridges.length === 1 &&
          inbound.inbound && inbound.wasAnswered && dialed[0] &&
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
    var inbound = getMockChannel();
    inbound.inbound = true;
    config = 'tests/testConfigs/invalidConfig.json';
    var sla = require('../lib/sla.js')(client, config, extension, inbound, '10')
      .catch(errHandler)
      .done();

    invalidConfigurationFile();
    function invalidConfigurationFile() {
      setTimeout(function() {
        if(configurationFailed) {
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
    var inbound = getMockChannel();
    inbound.inbound = true;
    config = 'tests/testConfigs/noEndpoints.json';
    var sla = require('../lib/sla.js')(client, config, extension, inbound, '10')
      .catch(errHandler)
      .done();

    noEndpoints();
    function noEndpoints() {
      setTimeout(function() {
        if(noEndpoints) {
          done();
        } else {
          noEndpoints();
        }
      }, asyncDelay);
    } 
  });
  it('should hangup inbound channel if all dialed channles fail to answer',
      function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound['inbound'] = 'yes';
    var sla = require('../lib/sla.js')(client, config, extension, inbound, '10')
  it('should mark a device as RINGING when dialing an outbound channel',
      function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound['inbound'] = 'yes';
    var sla = require('../lib/sla.js')(client, config, extension, inbound, '10')
      .catch(errHandler)
      .done();
    client.deviceStates.update({deviceName: 'Stasis:999',
      deviceState: 'NOT_INUSE'}, function() {});

    markAsRinging();
    function markAsRinging() {
      setTimeout(function() {
        if(isMixing && bridges.length === 1 && inbound['inbound'] &&
          dialed[0] && mockDeviceStates[0].hasRung &&
          mockDeviceStates[0].deviceName === 'Stasis:10') {
            done();
          } else {
            markAsRinging();
          }
      }, asyncDelay);
    }
  });
  it('should mark a device as RINGING when dialing multiple outbound channels',
      function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound['inbound'] = 'yes';
    var sla = require('../lib/sla.js')(client, config, extension, inbound, '10')
      .catch(errHandler)
      .done();
    client.deviceStates.update({deviceName: 'Stasis:10',
      deviceState: 'NOT_INUSE'}, function() {});

    markAsRinging();
    function markAsRinging() {
      setTimeout(function() {
        if(isMixing && bridges.length === 1 && inbound['inbound'] &&
          dialed[0] && dialed[1] && mockDeviceStates[0].hasRung &&
          mockDeviceStates[0].deviceName === 'Stasis:10') {
            done();
        } else {
          markAsRinging();
        }
      }, asyncDelay);
    }
  });
  it('should give the application an invalid configuration file and promptly ' +
      'fail out', function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound.inbound = true;
    config = 'tests/testConfigs/invalid.json';
    var sla = require('../lib/sla.js')(client, config, inbound, '42')
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
  it('should mark a device as INUSE when dialing an outbound channel',
      function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound.inbound = true;
    var sla = require('../lib/sla.js')(client, config, inbound, '42')
      .catch(errHandler)
      .done();
    client.deviceStates.update({deviceName: 'Stasis:10',
      deviceState: 'NOT_INUSE'}, function() {});
    answeringDelay = 2 * asyncDelay;

    markAsRinging();
    function markAsRinging() {
      setTimeout(function() {
        if(isMixing && bridges.length === 1 && inbound['inbound'] &&
          dialed[0] && dialed[0].answered && inbound.answered &&
          mockDeviceStates[0].hasRung &&
          mockDeviceStates[0].deviceName === 'Stasis:10' &&
          mockDeviceStates[0].hasBeenInUse) {
            done();
          } else {
            markAsRinging();
          }
      }, asyncDelay);
    } 
  });
  it('should test the configuration when there are no endpoints and ' +
      'fail out', function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound.inbound = true;
    config = 'tests/testConfigs/noEndpoints.json';
    var sla = require('../lib/sla.js')(client, config, inbound, '42')
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
  it('should mark a device as NOT_INUSE when no outbound channels answer',
      function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound.inbound = true;
    var sla = require('../lib/sla.js')(client, config, inbound, '42')
      .catch(errHandler)
      .done();
    client.deviceStates.update({deviceName: 'Stasis:10',
      deviceState: 'NOT_INUSE'}, function() {});
    answeringDelay = 2 * asyncDelay;

    markAsRinging();
    setTimeout(function() {
      dialed[0].hangup(function() {});
      dialed[1].hangup(function() {});
    }, asyncDelay);
    function markAsRinging() {
      setTimeout(function() {
        if(isMixing && bridges.length === 1 && inbound.inbound &&
          dialed[0] && dialed[1] && inbound.answered && !dialed[0].answered &&
          !dialed[1].answered && mockDeviceStates[0].hasRung &&
          mockDeviceStates[0].isIdle) {
            done();
          } else {
            markAsRinging();
          }
      }, asyncDelay);
    } 
  });
  it('should not mark a device INUSE when a trunk enters the shared extension',
      function(done) {
    var client = getMockClient();
    var inbound = getMockChannel();
    inbound['inbound'] = 'yes';
    bridges.push(getMockBridge({type: 'mixing', name: '10'}, function(){}));
    var sla = require('../lib/sla.js')(client, config, extension, inbound, '10')
      .catch(errHandler)
      .done();
    client.deviceStates.update({deviceName: 'Stasis:10',
      deviceState: 'NOT_INUSE', hasBeenInUse: false},
      function() {});
    answeringDelay = 2 * asyncDelay;

    markAsRinging();
    function markAsRinging() {
      setTimeout(function() {
        if(isMixing && bridges.length === 1 &&
          !mockDeviceStates[0].hasBeenInUse) {
            done();
        } else {
          markAsRinging();
        }
      }, asyncDelay);
    }
  });
});
