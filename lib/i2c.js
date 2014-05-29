/**
 * I2C bus mode for BusPirate
 */

var util       = require('util'),
    asyncblock = require('asyncblock'),
    events     = require('events');

module.exports = I2c;

/**
 * I2c - gives a buspirate I2Cbus mode capabilities
 */
function I2c(buspirate) {
  events.EventEmitter.call(this);
  var self = this;

  this.bp = buspirate;
  this.started = false;
  this.sniffer = false;
  this.reading = false;
  this.settings = {};

  // Special constants NEEDED to change mode
  this.constants = {
    MODE_ID: 0x02,
    MODE_NAME: 'i2c',
    MODE_ACK: 'I2C1'
  };

  this.bp.on('receive', function(data) {
    // Handle incoming data appropriately
    if (self.sniffer) {
      self.emit('sniff', find_bytes(data));
    }
  });

  this.bp.on('mode', function(m) {
    if (m != self.constants.MODE_NAME)
      self.started = false;
  });
}

// Event emitter!
util.inherits(I2c, events.EventEmitter);


/**
 * Call .start() to change the buspirate mode 
 * It changes mode and then sets the options
 * @param  {array} options options to pass on to setopts
 */
I2c.prototype.start = function(options) {
  var self = this;
  this.bp.switch_mode(this.constants, function(err, mode) {
    if (err) {
      self.bp.log('error', err);
      return;
    }
    else if (mode == self.constants.MODE_NAME) {
      self.started = true;
      self.setopts(options);
    }
  });
};


/**
 * A set of of defaults for I2C
 */
i2c_defaults = {
  speed: 5,    // I2C speed (kHz)
  power: 0,    // Off/On
  pullups: 0,  // Off/On
  AUX: 0,      // Off/On
  CS: 0        // Off/On
};

/**
 * Setopts sets up the BusPirate as required, emitting 'ready' when done
 * @param  {array} options To override the defaults above
 */
I2c.prototype.setopts = function(options) {
  var self = this;
  var opts = {};
  options = options || {};

  // Must be started first
  if (!this.started) {
    this.start(options);
    return;
  }

  // Parse options
  for (var opt in i2c_defaults) {
    opts[opt] = options[opt] || i2c_defaults[opt];
  }
  this.settings = opts;

  var speeds = {
    5:   0x00,
    50:  0x01,
    100: 0x02,
    400: 0x03
  };

  //01000000 – Configure peripherals w=power, x=pullups, y=AUX, z=CS
  //Note: CS pin always follows the current HiZ pin configuration. AUX is always a normal pin output (0=GND, 1=3.3volts).
  var speedcmd = speeds[opts.speed] || speeds[i2c_defaults.speed],
    w = 8 * opts.power,
    x = 4 * opts.pullups,
    y = 2 * opts.AUX,
    z = 1 * opts.CS,
    err = false;

  // Write everything (synchronously)
  asyncblock(function(flow) {
    self.bp.sync_write(flow, 0x60 + speedcmd);
    err = self.bp.sync_wait(flow, 0x01);

    self.bp.sync_write(flow, 0x40 + w+x+y+z);
    err = self.bp.sync_wait(flow, 0x01) || err;

    if (err) {
      self.bp.emit('error', err);
    } else {
      self.bp.log('i2c', 'Started, speed: '+opts.speed);
      self.emit('ready');
    }
  });
};


/*****[ I2C operations routines ]******************************************/

/**
 * Enable / disable CS according to this.settings.cs_polarity
 * enable  pola    code
 *    0      0     0x03
 *    1      0     0x02
 *    0      1     0x02
 *    1      1     0x03
 * @param  {Bool}   on       Desired state of CS
 * @param  {Function} callback To be called when done
 */
I2c.prototype.cs = function(enable, callback) {
  var self = this;
  var code = 0x03 - 1*(enable^this.settings.cs_polarity);

  this.bp.write(code);
  this.bp.wait_for_data(0x01, callback);
};


/**
 * Set I2C bus sniffing capabilities. TODO: test and fix logic holes! :)
 * @param  {bool|string}   how  what CS state to sniff on. false=>disable
 */
I2c.prototype.sniff = function(how, callback) {
  var self = this;

  if (!this.started) {
    return new Error('I2c must be started before sniffing');
  }

  // If it's already started, interperet this as a restart request
  if (this.sniffer) {
    this.bp.write('r');
    return;
  }
  else {
    this.bp.write(0x0F);
    this.bp.wait_for_data(0x01, function(err) {
      if (!err) {
        this.sniffer = how;
        self.bp.log('i2c', 'Sniffer status: '+how);
        self.sniffer = how;
        self.emit('sniffer', how);
        if (callback) callback(err);
      }
    });
  }
};


/**
 * Write and read bytes of data from I2C bus. TODO: test this more
 * @param  {number}   num      Number of bytes to read
 * @param  {bool}   ignore_cs  Optional - don't toggle CS when writing
 * @param  {Function} callback Execute this when done
 */
I2c.prototype.write_read = function(write, ignore_cs, callback) {
  var self = this,
    lenbyte = 0x10 + write.length - 1;

  if (typeof callback === "undefined") {
    callback = ignore_cs;
    ignore_cs = false;
  }
  if (!this.started) {
    return new Error('I2c must be started before writing');
  }

  // TODO: block BP/I2C operation while a read/write is in progress

  if (write.length > 16) {
    this.bp.log('i2c', 'Big Bulk write:', write);
    var ret = [];

    asyncblock(function(flow) {
      self.cs(true, flow.add());
      flow.wait();

      for (var i=0; i < Math.floor(write.length/16); i++) {
        self.write_read(write.slice(i*16, (i*16)+16), true, flow.add());
        ret.push.apply(ret, flow.wait());
      }

      if (i*16 < write.length) {
        self.write_read(write.slice(i*16), true, flow.add());
        ret.push.apply(ret, flow.wait());
      }

      self.cs(false, flow.add());
      flow.wait();
      callback(null, ret);
    });
  }
  else {
    this.bp.log('i2c', 'Bulk write:', write);
    var rec = [];

    asyncblock(function(flow) {
      if (!ignore_cs) {
        self.cs(true, flow.add());
        flow.wait();
      }

      self.bp.sync_write(flow, lenbyte);
      self.bp.sync_wait(flow, 0x01);

      for (var i = 0; i < write.length; i++) {
        self.bp.sync_write(flow, write[i]);   // Write data
        self.bp.wait_for_data('', flow.add());  // Wait for reply
        rec.push(flow.wait()[0]);
      }
      if (!ignore_cs) {
        self.cs(false, flow.add());
        flow.wait();
      }

      callback(null, rec);
    });
  }
};


/**
 * Read num bytes from I2c
 * @param  {Number}   num      
 * @param  {Function} callback [description]
 */
I2c.prototype.read = function(num, callback) {
  var self = this,
    dummy = [],
    lenbyte = 0x10 + num-1;

  // Build an array of dummy data
  for (var i = num-1; i >= 0; i--)
    dummy.push(0xff);

  this.write_read(dummy, callback);
};



/*****[ Utilities ]******************************************************/

var bytes_expected = 0;
/**
 * Parse a buffer and return object of MOSI and MISO streams
 * ie extract MOSI and MISO streams from data such as 'xxxx\AB\cdxxx\efxxx'
 * It will also correctly extract the data even if it is separated into two
 * data buffers.  It assumes data.length > 0.... 
 * @param  {Buffer} data The data to parse
 * @return {Object}      { mosi: [,,,], miso: [,,,] }
 */
function find_bytes(data) {
  var slash = 0x5C,
    mosi = [],
    miso = [],
    j = 0;

  // TODO: look for '[' and ']' in the stream (CS enable/disable)

  // Check whether we are expecting data (ie received a \ but didn't get
  // enough bytes after it in the previous Buffer).
  if (bytes_expected == 2) {
    if (data.length >= 2){
      mosi.push(data[j++]);
      miso.push(data[j++]);
      bytes_expected = 0;
    }
    else {
      mosi.push(data[j++]);
      bytes_expected = 1;
    }
  }
  else if (bytes_expected == 1) {
    miso.push(data[j++]);
    bytes_expected = 0;
  }

  // Deal with the rest of the data
  for (var i = j; i < data.length; i++) {
    if (data[i] == slash) {
      if (i<data.length-2) {
        mosi.push(data[++i]);
        miso.push(data[++i]);
      }
      else {
        // If we didn't get enough data, wait for it next time!
        if (i == data.length-1) {
          bytes_expected = 2;
        }
        else if (i == data.length-2) {
          mosi.push(data[++i]);
          bytes_expected = 1;
        }
      }
    }
  }

  return {mosi: mosi, miso: miso};
}