"use strict";
var net = require('net');
var controlMessages = require('./messages.js');
var events = require('events');

function M1Control(){
	this.zones=[];
	this.thermostats=[];
	this.lights=[];
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
	var promiseChain = null;
	this.controlInitSequence.forEach((controlInitializer) => {
		if (!promiseChain) {
			promiseChain = controlInitializer.bind(this)();
		}
		else {
			promiseChain = promiseChain.then(controlInitializer.bind(this));
		}
	});
	if (!promiseChain) {
		promiseChain = Promise.resolve(true); // Maybe we had no init items?
	}

	return promiseChain;
}

M1Control.prototype.updateControl = function(obj) {
	if (!obj) {
		return Promise.resolve(false); // Stop processing
	}

	// Don't process junk, don't process messages twice
	if (!(obj instanceof Object) || !!obj.processed) {
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
		return this.updateControlZoneDefinitions(obj, controlDataResult.controlData);
	}
	else if (obj instanceof controlMessages.ASCIIStringDefinitionReply) {
		return this.updateControlASCIIStringData(obj, controlDataResult.controlData);
	}
	else if (obj instanceof controlMessages.ThermostatDataReply) {
		return this.updateControlThermostatData(obj, controlDataResult.controlData);
	}

	// Default
	return Promise.resolve(true); // Keep processing
}

M1Control.prototype.updateControlZoneDefinitions = function(obj, controlData) {
	this.zones = controlData;
	return Promise.resolve(true); // Keep processing
}

M1Control.prototype.updateControlASCIIStringData = function(obj, controlData) {
	if (controlData.stringAddress === 0) {
		//this.emit('diag', "Abort string processing.");
		return Promise.resolve(false); // Stop processing strings
	}

	if (controlData.stringType === controlMessages.ASCIIStringDefinitionType.ZONE_NAME.typeId) {
		for (let i = 0; i < this.zones.length; ++i) {
			if (controlData.stringAddress === this.zones[i].zoneId) {
				this.zones[i].zoneName = controlData.stringValue;
				return Promise.resolve(true); // Keep processing
			}
		}
	}
	else if (controlData.stringType === controlMessages.ASCIIStringDefinitionType.THERMOSTAT_NAME.typeId) {
		for (let i = 0; i < this.thermostats.length; ++i) {
			if (controlData.stringAddress === this.thermostats[i].thermostatId) {
				this.thermostats[i].thermostatName = controlData.stringValue;
				this.thermostats[i].enabled = true;
				this.emit('diag', "Thermostat: " + this.thermostats[i].thermostatId + " - " + this.thermostats[i].thermostatName);
				return Promise.resolve(true); // Keep processing
			}
		}
	}
	else if (controlData.stringType === controlMessages.ASCIIStringDefinitionType.LIGHT_NAME.typeId) {
		for (let i = 0; i < this.lights.length; ++i) {
			if (controlData.stringAddress === this.lights[i].lightId) {
				this.lights[i].lightName = controlData.stringValue;
				this.lights[i].enabled = true;
				this.emit('diag', "Light: " + this.lights[i].lightId + " - " + this.lights[i].lightName);
				return Promise.resolve(true); // Keep processing
			}
		}
	}
	return Promise.resolve(true); // Keep processing
}

M1Control.prototype.getControlStrings = function(stringType, items, getItemId, updateIf) {
	var promiseChain = null;
	var updateThisControl = this.updateControl.bind(this);
	// Check all the individual items
	for (let i = 0; i < items.length; ++i) {
		if (updateIf(items[i])) {
			let sd = new controlMessages.ASCIIStringDefinitionRequest(stringType, getItemId(items[i]));
			if (!promiseChain) {
				promiseChain = sd.request(this).then(updateThisControl);
			}
			else {
				promiseChain = promiseChain.then((keepProcessing) => { 
					if (keepProcessing) {
						// It's possible for there to be gaps in the list that the control will skip, so don't waste time if we've already got the name
						if (updateIf(items[i])) {
							return sd.request(this); 
						}
						else {
							return Promise.resolve(true); // Skip
						}
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
		this.emit('diag', "Warning: Failed to get control names of type: " + stringType.stringDefinitionTypeDescription + " Reason: " + reason);
	});
	return promiseChain;
}

M1Control.prototype.updateControlThermostatData = function(obj, controlData) {
	for (let i = 0; i < this.thermostats.length; ++i) {
		if (controlData.thermostatId === this.thermostats[i].thermostatId) {
			let thermostatName = this.thermostats[i].thermostatName;
			this.thermostats[i] = controlData;
			this.thermostats[i].thermostatName = thermostatName;
			this.emit('diag', "Thermostat Data: " + this.thermostats[i].thermostatId + " - " + this.thermostats[i].currentTemp + " degF  Mode: " + this.thermostats[i].mode.toString());
			return Promise.resolve(true); // Keep processing
		}
	}
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
	return this.getControlStrings(controlMessages.ASCIIStringDefinitionType.ZONE_NAME, 
								  	this.zones, 
								  	(item) => { 
								  		return item.zoneId; 
								  	}, 
								  	(item) => {
								  		return !item.zoneName;
									});
}

M1Control.prototype.getThermostatDefinitions = function() {
	// Init thermostats
	for (let i = 0; i < 16; ++i) {
		this.thermostats[i] = controlMessages.CreateThermostatData(i+1);
	}

	return this.getThermostatNames().then(this.getThermostatTemperatures.bind(this));
}

M1Control.prototype.getThermostatNames = function() {
	return this.getControlStrings(controlMessages.ASCIIStringDefinitionType.THERMOSTAT_NAME, 
								  	this.thermostats, 
								  	(item) => { 
								  		return item.thermostatId; 
								  	}, 
								  	(item) => {
								  		return !item.thermostatName;
									});
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

M1Control.prototype.getLightDefinitions = function() {
	// There are 256 possible lights
	for (let i = 0; i < 256; ++i) {
		this.lights[i] = { lightId: i+1, enabled: false };
	}
	return this.getLightNames();
}

M1Control.prototype.getLightNames = function() {
	return this.getControlStrings(controlMessages.ASCIIStringDefinitionType.LIGHT_NAME, 
							  	this.lights, 
							  	(item) => { 
							  		return item.lightId; 
							  	}, 
							  	(item) => {
							  		return !item.lightName;
								});
}

// Defines the sequence of control init tasks.  These tasks should all return a Promise.
M1Control.prototype.controlInitSequence = [M1Control.prototype.getZoneDefinitions,
										   M1Control.prototype.getThermostatDefinitions,
										   M1Control.prototype.getLightDefinitions];

module.exports.M1Control = M1Control;
module.exports.Messages = controlMessages;