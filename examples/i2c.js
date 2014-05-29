/**
 * I2C bus example
 */

var BusPirate = require('../');

// Initialise buspirate.  This also does a console reset and enters binmode
var pirate = new BusPirate('COM4', 115200, true);

// The pirate is an event emitter - it lets the code know when stuff happens
// pirate.on('error', function(e) {
// 	console.log(e);
// });

pirate.on('connected', function() {
	// Start I2C
	pirate.i2c.start({
		power: 1,
		pullups: 1,
		speed: 400
	});
});

pirate.i2c.on('ready', function() {
	console.log('ready');
	// Write and read some data
	// pirate.i2c.read(3, function(b) {
	// 	console.log('Read: ', b);
	// });
	// pirate.i2c.write_read('ABCDEFGHIJKLMNOPABCDEF', function(err, data) {
	// 	console.log('Received: ', data);
	// });

	// pirate.i2c.sniff('low');
});


// Handle sniffer data
pirate.i2c.on('sniff', function(data) {
	console.log(data.mosi.map(function(x) {
		return String.fromCharCode(x);
	}), data.miso);
});

module.exports = pirate;