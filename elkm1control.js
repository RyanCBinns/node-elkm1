"use strict";
var net = require('net');
var controlMessages = require('./messages.js');
var events = require('events');

function M1Control(){
	this.zones=[];
	this.controlMessageHandler = null;
	this.connection = new net.Socket();
}

M1Control.prototype = new events.EventEmitter();
M1Control.prototype.connect = function(config) {
	this.connection.connect(config.port, config.hostname, () => {
		this.emit('diag','Connected to ' + config.hostname + ':' + config.port);
		
		var promise = this.initControl();
		promise.then((value) => {
			this.emit('diag',"Control Initialized."); // Success!
		}, (reason) => {
			this.emit('diag',"Error: " + reason); // Error!
		});
	});

	this.connection.on('data', (data) => {
		this.controlMessageHandler.handleMessage(data);
	});

	this.connection.on('close', () => {
		this.emit('diag','Connection closed');
	});
}

M1Control.prototype.initControl = function() {
	this.controlMessageHandler = new controlMessages.ControlMessageHandler();
	this.controlMessageHandler.subscribe(this.handleControlEvent.bind(this));
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
	// Emit to subscribers of any message
	this.emit('any', obj);

	// Emit to specific message listeners
	var messageCommand = 'undefined';
	if (obj.command) {
		messageCommand = obj.command.toString().toLowerCase();
	}
	this.emit(messageCommand, obj);
}

M1Control.prototype.printZoneDefinitions = function() {
	this.emit('diag',"Zone Definitions");
	for (let i = 0; i < this.zones.length; ++i) {
		let curZone = this.zones[i];
		this.emit('diag',"ZoneID: " + curZone.zoneId + " Zone Name: " + curZone.zoneName + " Type: " + curZone.zoneDefinition.zoneTypeDescription);
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

module.exports.M1Control = M1Control;
module.exports.Messages = controlMessages;