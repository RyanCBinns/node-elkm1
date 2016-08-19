"use strict";
var net = require('net');
var controlMessages = require('./messages.js');

var m1Control = null;
function M1Control(){
	this.zones=[];
	this.controlMessageHandler = null;
	this.connection = null;
}

//M1Control.prototype = new EventEmitter();
M1Control.prototype.initControl = function(socket) {
	this.connection = socket;
	this.controlMessageHandler = new controlMessages.ControlMessageHandler();
	this.controlMessageHandler.subscribe(this.handleControlEvent);
	return this.getZoneDefinitions();
}

M1Control.prototype.updateControl = function(obj) {
	var controlUpdateResult = obj.updateControl(this);
	if (!controlUpdateResult)
		return Promise.reject("Unknown failure");
	if (!controlUpdateResult.result) {
		return Promise.reject(controlUpdateResult.reason);
	}
}

M1Control.prototype.handleControlEvent = function(obj) {
	if (obj instanceof controlMessages.ZoneChangeUpdate) {
		var zoneChangeInfo = obj.getZoneChangeInfo();
		console.log("Zone change: " + zoneChangeInfo.zoneId + " Status High: " + zoneChangeInfo.zoneStatusHigh.description);
	}
}

M1Control.prototype.printZoneDefinitions = function() {
	console.log("Zone Definitions");
	for (let i = 0; i < this.zones.length; ++i) {
		let curZone = this.zones[i];
		console.log("ZoneID: " + curZone.zoneId + " Zone Name: " + curZone.zoneName + " Type: " + curZone.zoneDefinition.zoneTypeDescription);
	}
}

M1Control.prototype.getZoneDefinitions = function() {
	var zd = new controlMessages.ZoneDefinitionRequest();
	var updateThisControl = this.updateControl.bind(this);
	var getThisZoneNames = this.getZoneNames.bind(this);
	var printThisDefinitions = this.printZoneDefinitions.bind(this);
	return zd.request(this.connection, this.controlMessageHandler).then(updateThisControl).then(getThisZoneNames).then(printThisDefinitions);
}

M1Control.prototype.getZoneNames = function() {
	var thisConnection = this.connection;
	var thisHandler = this.controlMessageHandler;
	var promiseChain = null;
	var updateThisControl = this.updateControl.bind(this);
	for (let i = 0; i < this.zones.length; ++i) {
		if (!this.zones[i].zoneName) {
			let sd = new controlMessages.ASCIIStringDefinitionRequest(controlMessages.ASCIIStringDefinitionType.ZONE_NAME, this.zones[i].zoneId);
			if (!promiseChain) {
				promiseChain = sd.request(thisConnection, thisHandler).then(updateThisControl);
			}
			else {
				promiseChain = promiseChain.then(function() { return sd.request(thisConnection, thisHandler); }).then(updateThisControl);
			}
		}
	}
	return promiseChain;
}

m1Control = new M1Control();


var client = new net.Socket();
client.connect(2101, '10.0.1.55', function() {
	console.log('Connected');
	
	var promise = m1Control.initControl(client);
	promise.then(function(value) {
	  console.log("Control Initialized."); // Success!
	}, function(reason) {
	  console.log(reason); // Error!
	});
});

client.on('data', function(data) {
	m1Control.controlMessageHandler.handleMessage(data);
});

client.on('close', function() {
	console.log('Connection closed');
});