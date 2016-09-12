"use strict";
var net = require('net');
var controlMessages = require('./messages.js');
var events = require('events');

function M1Control(){
	this.zones=[];
	this.thermostats=[];
	this.connection = new net.Socket();
	this.connected = false;
}

M1Control.prototype = new events.EventEmitter();
M1Control.prototype.connect = function(config) {
	this.connection.connect(config.port, config.hostname, () => {
		this.connected = true;
		this.emit('diag','Connected to ' + config.hostname + ':' + config.port);
		
		var promise = this.initControl();
		promise.then((value) => {
			this.emit('diag',"Control Initialized."); // Success!
		}, (reason) => {
			this.emit('diag',"Error: " + reason); // Error!
		});
	});

	this.connection.on('data', (data) => {
		this.handleRawMessage(data);
	});

	this.connection.on('close', () => {
		this.connected = false;
		this.emit('diag','Connection closed');
	});
}

M1Control.prototype.initControl = function() {
	// Init thermostats
	for (let i = 0; i < 16; ++i) {
		this.thermostats[i] = controlMessages.CreateThermostatData(i+1);
	}

	return this.getZoneDefinitions().then(this.getThermostatNames.bind(this)).then(this.getThermostatTemperatures.bind(this));
}

M1Control.prototype.updateControl = function(obj) {
	if (!obj) {
		return Promise.resolve(false); // Stop processing
	}

	// Don't process messages twice
	if (!!obj.processed) {
		return Promise.resolve(true); // Keep going
	}
	obj.processed = true;

	var controlDataResult = obj.getControlData();
	if (!controlDataResult) {
		return Promise.reject("Unknown failure, null result");
	}

	if (!(controlDataResult instanceof controlMessages.ControlDataResult))
	{
		return Promise.reject("Unknown failure, wrong type");
	}

	if (!controlDataResult.result) {
		return Promise.reject(controlDataResult.reason);
	}

	if (obj instanceof controlMessages.ZoneDefinitionReply) {
		this.zones = controlDataResult.controlData;
		return Promise.resolve(true); // Keep processing
	}
	else if (obj instanceof controlMessages.ASCIIStringDefinitionReply) {
		if (controlDataResult.controlData.stringAddress === 0) {
			//this.emit('diag', "Abort string processing.");
			return Promise.resolve(false); // Stop processing strings
		}

		if (controlDataResult.controlData.stringType === controlMessages.ASCIIStringDefinitionType.ZONE_NAME.typeId) {
			for (let i = 0; i < this.zones.length; ++i) {
				if (controlDataResult.controlData.stringAddress === this.zones[i].zoneId) {
					this.zones[i].zoneName = controlDataResult.controlData.stringValue;
					return Promise.resolve(true); // Keep processing
				}
			}
		}
		else if (controlDataResult.controlData.stringType === controlMessages.ASCIIStringDefinitionType.THERMOSTAT_NAME.typeId) {
			for (let i = 0; i < this.thermostats.length; ++i) {
				if (controlDataResult.controlData.stringAddress === this.thermostats[i].thermostatId) {
					this.thermostats[i].thermostatName = controlDataResult.controlData.stringValue;
					this.thermostats[i].enabled = true;
					this.emit('diag', "Thermostat: " + this.thermostats[i].thermostatId + " - " + this.thermostats[i].thermostatName);
					return Promise.resolve(true); // Keep processing
				}
			}
		}
	}
	else if (obj instanceof controlMessages.ThermostatDataReply) {
		for (let i = 0; i < this.thermostats.length; ++i) {
			if (controlDataResult.controlData.thermostatId === this.thermostats[i].thermostatId) {
				let thermostatName = this.thermostats[i].thermostatName;
				this.thermostats[i] = controlDataResult.controlData;
				this.thermostats[i].thermostatName = thermostatName;
				this.emit('diag', "Thermostat Data: " + this.thermostats[i].thermostatId + " - " + this.thermostats[i].currentTemp + " degF  Mode: " + this.thermostats[i].mode.toString());
				return Promise.resolve(true); // Keep processing
			}
		}
		return Promise.resolve(true);
	}

	// Default
	return Promise.resolve(true); // Keep processing
}

M1Control.prototype.sendRawDataToControl = function(rawMessage) {
	if (!this.connected) {
		this.emit('diag', "Not connected to control.");
	}
	this.emit('debug', "Sending: " + rawMessage);

	// Have to trim the string and append some padding or certain commands don't work?  (My M1 iPhone app uses this padding, so I'll copy it)
	this.connection.write(rawMessage.toString().trim() + "\x0D\x0A");
}

M1Control.prototype.handleRawMessage = function(rawMessage) {
	this.emit('debug', "Received: " + rawMessage);
	var tempMessage = new controlMessages.ParseControlMessage(rawMessage);

	if (!tempMessage.valid)
	{
		this.emit('diag', "Invalid message received: " + tempMessage.rawMessage);
		return;
	}

	if (tempMessage.messageType() === controlMessages.ControlMessageType.UNDEFINED)
	{
		this.emit('diag', "Undefined message type received: " + tempMessage.rawMessage);
		return;
	}

	this.handleControlEvent(tempMessage);
}

M1Control.prototype.handleControlEvent = function(obj) {
	// Emit to subscribers of any message
	this.emit('any', obj);

	// Emit to specific message listeners
	var messageCommand = 'undefined';
	if (obj.command) {
		messageCommand = obj.command.toString().toUpperCase();
	}
	this.emit(messageCommand, obj);

	// Perhaps this is relevant to us?  Check it out on the next event loop tick
	setTimeout(this.updateControl.bind(this, obj), 0);
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
	return zd.request(this).then(updateThisControl).then(getThisZoneNames).then(printThisDefinitions);
}

M1Control.prototype.getZoneNames = function() {
	var promiseChain = null;
	var updateThisControl = this.updateControl.bind(this);
	for (let i = 0; i < this.zones.length; ++i) {
		if (!this.zones[i].zoneName) {
			let sd = new controlMessages.ASCIIStringDefinitionRequest(controlMessages.ASCIIStringDefinitionType.ZONE_NAME, this.zones[i].zoneId);
			if (!promiseChain) {
				promiseChain = sd.request(this).then(updateThisControl);
			}
			else {
				promiseChain = promiseChain.then((keepProcessing) => {
					if (keepProcessing) { 
						return sd.request(this); 
					}
					else
					{
						return Promise.resolve(false);
					}
				}).then(updateThisControl);
			}
		}
	}
	if (!promiseChain) {
		promiseChain = Promise.resolve(true); // Just keep going, we didn't find any zones without names
	}

	promiseChain = promiseChain.catch((reason) => {
		this.emit('diag', "Failed to get zone names: " + reason);
	});
	return promiseChain;
}

M1Control.prototype.getThermostatNames = function() {
	var promiseChain = null;
	var updateThisControl = this.updateControl.bind(this);
	// There are only 16 possible thermostats
	for (let i = 0; i < this.thermostats.length; ++i) {
		if (!this.thermostats[i].thermostatName) {
			let sd = new controlMessages.ASCIIStringDefinitionRequest(controlMessages.ASCIIStringDefinitionType.THERMOSTAT_NAME, this.thermostats[i].thermostatId);
			if (!promiseChain) {
				promiseChain = sd.request(this).then(updateThisControl);
			}
			else {
				promiseChain = promiseChain.then((keepProcessing) => { 
					if (keepProcessing) { 
						return sd.request(this); 
					}
					else
					{
						return Promise.resolve(false);
					}
				}).then(updateThisControl);
			}
		}
	}
	if (!promiseChain) {
		promiseChain = Promise.resolve(true); // Just keep going, we didn't find any enabled thermostats
	}

	promiseChain = promiseChain.catch((reason) => {
		this.emit('diag', "Failed to get thermostat names: " + reason);
	});
	return promiseChain;
}

M1Control.prototype.getThermostatTemperatures = function() {
	var promiseChain = null;
	var updateThisControl = this.updateControl.bind(this);
	// There are only 16 possible thermostats
	for (let i = 0; i < this.thermostats.length; ++i) {
		if (!this.thermostats[i].enabled) {
			continue;
		}

		let tr = new controlMessages.ThermostatDataRequest(this.thermostats[i].thermostatId);
		if (!promiseChain) {
			promiseChain = tr.request(this).then(updateThisControl);
		}
		else {
			promiseChain = promiseChain.then((keepProcessing) => { 
				if (keepProcessing) { 
					return tr.request(this); 
				}
				else
				{
					return Promise.resolve(false);
				}
			}).then(updateThisControl);
		}
	}

	if (!promiseChain) {
		promiseChain = Promise.resolve(true); // Just keep going, we didn't find any enabled thermostats
	}

	promiseChain = promiseChain.catch((reason) => {
		this.emit('diag', "Failed to get temperature data: " + reason);
	});

	return promiseChain;
}

module.exports.M1Control = M1Control;
module.exports.Messages = controlMessages;