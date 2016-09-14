"use strict";

var M1Control = require('./elkm1control.js');
var m1Control = new M1Control.M1Control();

var config = {
	hostname: '10.0.1.55',
	port: 2101
};

m1Control.connect(config);

m1Control.on('diag', (logmessage) => {
	console.log("M1Control: " + logmessage);
});

m1Control.on('debug', (logmessage) => {
	console.log("Debug: " + logmessage);
});

m1Control.on('any', (message) => {
	if (message instanceof M1Control.Messages.ZoneChangeUpdate) {
		var zoneChangeInfo = message.getControlData().controlData;
		console.log("Zone change: " + zoneChangeInfo.zoneId + " Status High: " + zoneChangeInfo.zoneStatusHigh.description);
	}
});