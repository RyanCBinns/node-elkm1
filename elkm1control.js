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

M1Control.prototype.updateControl = function(messageHandler, obj) {
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

	// Have we specified a custom message handler?
	if (messageHandler) {
		return Promise.resolve(messageHandler(controlDataResult.controlData));
	}

	// Default handlers  (unsolicited events)
	this.defaultMessageHandlers.forEach((messageHandler) => {
		if (obj instanceof messageHandler.message) {
			return Promise.resolve(messageHandler.handler.call(this, controlDataResult.controlData));
		}
	});

	// Default
	return Promise.resolve(true); // Keep processing
}

M1Control.prototype.createControlRequestChain = function(items, processIf, getRequest, handleError, messageHandler) {
	var promiseChain = null;
	var updateThisControl = this.updateControl.bind(this, messageHandler);
	// Check all the individual items
	for (let i = 0; i < items.length; ++i) {
		if (processIf(items[i])) {
			let controlRequest = getRequest(items[i]);
			if (!promiseChain) {
				promiseChain = controlRequest.request(this).then(updateThisControl);
			}
			else {
				promiseChain = promiseChain.then((keepProcessing) => { 
					if (keepProcessing) {
						// It's possible for there to be gaps in the list that the control will skip, so don't waste time if we no longer need to process it
						if (processIf(items[i])) {
							return controlRequest.request(this); 
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

	if (handleError) {
		promiseChain = promiseChain.catch(handleError);
	}
	return promiseChain;
}

M1Control.prototype.updateControlStrings = function(stringType, items, getItemId, updateIf, messageHandler) {
	return this.createControlRequestChain(items, 
										updateIf, 
										(item) => { 
											return new controlMessages.ASCIIStringDefinitionRequest(stringType, getItemId(item)); 
										}, 
										(reason) => { 
											this.emit('diag', "Warning: Failed to get control names of type: " + stringType.stringDefinitionTypeDescription + " Reason: " + reason); 
										},
										messageHandler);
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
	setTimeout(this.updateControl.bind(this, null, obj), 0);
}

M1Control.prototype.printZoneDefinitions = function() {
	this.emit('diag',"Zone Definitions");
	for (let i = 0; i < this.zones.length; ++i) {
		let curZone = this.zones[i];
		this.emit('diag',"ZoneID: " + curZone.zoneId + " Zone Name: " + curZone.zoneName + " Type: " + curZone.zoneDefinition.zoneTypeDescription);
	}
}

M1Control.prototype.updateZoneDefinitions = function() {
	var zd = new controlMessages.ZoneDefinitionRequest();
	var updateThisControl = this.updateControl.bind(this, (controlData) => {
		this.zones = controlData;
		return true; // Keep processing
	});
	var updateThisZoneNames = this.updateZoneNames.bind(this);
	var printThisDefinitions = this.printZoneDefinitions.bind(this);
	var updateThisAllZoneStatus = this.updateAllZoneStatus.bind(this);
	return zd.request(this).then(updateThisControl).then(updateThisZoneNames).then(printThisDefinitions).then(updateThisAllZoneStatus);
}

M1Control.prototype.updateZoneNames = function() {
	return this.updateControlStrings(controlMessages.ASCIIStringDefinitionType.ZONE_NAME, 
								  	this.zones, 
								  	(item) => { 
								  		return item.zoneId; 
								  	}, 
								  	(item) => {
								  		return !item.zoneName;
									},
									(controlData) => {
										if (controlData.stringAddress === 0) {
											return false; // Stop processing strings
										}
										if (controlData.stringType === controlMessages.ASCIIStringDefinitionType.ZONE_NAME.typeId) {
											for (let i = 0; i < this.zones.length; ++i) {
												if (controlData.stringAddress === this.zones[i].zoneId) {
													this.zones[i].zoneName = controlData.stringValue;
													return true; // Keep processing
												}
											}
										}
										return true; // Keep processing anyway
									});
}

M1Control.prototype.updateZoneStatus = function(zoneStatus) {
	for (let i = 0; i < this.zones.length; ++i) {
		if (zoneStatus.zoneId === this.zones[i].zoneId) {
			let zoneName = "";
			if (this.zones[i].zoneName)
				zoneName = this.zones[i].zoneName;
			this.emit('diag',"Zone change: " + zoneName + " (" + zoneStatus.zoneId + ") - Status High: " + zoneStatus.zoneStatusHigh.description);
			this.zones[i].zoneStatusHigh = zoneStatus.zoneStatusHigh;
			this.zones[i].zoneStatusLow = zoneStatus.zoneStatusLow;
			break;
		}
	}
}

M1Control.prototype.updateAllZoneStatus = function() {
	var zs = new controlMessages.ZoneStatusRequest();
	var updateThisControl = this.updateControl.bind(this, (controlData) => {
		for (let i = 0; i < controlData.length; ++i) {
			this.updateZoneStatus(controlData[i]);
		}
		return true; // Keep processing
	});
	return zs.request(this).then(updateThisControl);
}

M1Control.prototype.updateThermostatDefinitions = function() {
	// Init thermostats
	for (let i = 0; i < 16; ++i) {
		this.thermostats[i] = controlMessages.CreateThermostatData(i+1);
	}

	return this.updateThermostatNames().then(this.updateThermostatTemperatures.bind(this));
}

M1Control.prototype.updateThermostatNames = function() {
	return this.updateControlStrings(controlMessages.ASCIIStringDefinitionType.THERMOSTAT_NAME, 
								  	this.thermostats, 
								  	(item) => { 
								  		return item.thermostatId; 
								  	}, 
								  	(item) => {
								  		return !item.thermostatName;
									},
									(controlData) => {
										if (controlData.stringAddress === 0) {
											return false; // Stop processing strings
										}
										if (controlData.stringType === controlMessages.ASCIIStringDefinitionType.THERMOSTAT_NAME.typeId) {
											for (let i = 0; i < this.thermostats.length; ++i) {
												if (controlData.stringAddress === this.thermostats[i].thermostatId) {
													this.thermostats[i].thermostatName = controlData.stringValue;
													this.thermostats[i].enabled = true;
													this.emit('diag', "Thermostat: " + this.thermostats[i].thermostatId + " - " + this.thermostats[i].thermostatName);
													return true; // Keep processing
												}
											}
										}
										return true; // Keep processing anyway
									});
}

M1Control.prototype.updateThermostatTemperature = function(controlData) {
	for (let i = 0; i < this.thermostats.length; ++i) {
		if (controlData.thermostatId === this.thermostats[i].thermostatId) {
			let thermostatName = this.thermostats[i].thermostatName;
			this.thermostats[i] = controlData;
			this.thermostats[i].thermostatName = thermostatName;
			this.emit('diag', "Thermostat Data: " + this.thermostats[i].thermostatId + " - " 
				+ this.thermostats[i].currentTemp + " degF  Mode: " + this.thermostats[i].mode.toString());
			return true; // Keep processing
		}
	}
	return true; // Keep processing anyway
}

M1Control.prototype.updateThermostatTemperatures = function() {
	return this.createControlRequestChain(this.thermostats, 
									(item) => {
										return item.enabled;
									}, 
									(item) => { 
										return new controlMessages.ThermostatDataRequest(item.thermostatId); 
									}, 
									(reason) => { 
										this.emit('diag', "Failed to get temperature data: " + reason); 
									},
									(controlData) => {
										return this.updateThermostatTemperature(controlData);
									});
}

M1Control.prototype.updateLightDefinitions = function() {
	// There are 256 possible lights
	for (let i = 0; i < 256; ++i) {
		this.lights[i] = { lightId: i+1, enabled: false };
	}
	return this.updateLightNames();
}

M1Control.prototype.updateLightNames = function() {
	return this.updateControlStrings(controlMessages.ASCIIStringDefinitionType.LIGHT_NAME, 
							  	this.lights, 
							  	(item) => { 
							  		return item.lightId; 
							  	}, 
							  	(item) => {
							  		return !item.lightName;
								},
								(controlData) => {
									if (controlData.stringAddress === 0) {
										return false; // Stop processing strings
									}
									if (controlData.stringType === controlMessages.ASCIIStringDefinitionType.LIGHT_NAME.typeId) {
										for (let i = 0; i < this.lights.length; ++i) {
											if (controlData.stringAddress === this.lights[i].lightId) {
												this.lights[i].lightName = controlData.stringValue;
												this.lights[i].enabled = true;
												this.emit('diag', "Light: " + this.lights[i].lightId + " - " + this.lights[i].lightName);
												return true; // Keep processing
											}
										}
									}
									return true; // Keep processing anyway
								});
}

// Defines the sequence of control init tasks.  These tasks should all return a Promise.
M1Control.prototype.controlInitSequence = [M1Control.prototype.updateZoneDefinitions,
										   M1Control.prototype.updateThermostatDefinitions,
										   M1Control.prototype.updateLightDefinitions];

M1Control.prototype.defaultMessageHandlers = [{message: controlMessages.ZoneChangeUpdate    ,  handler: M1Control.prototype.updateZoneStatus           },
											  {message: controlMessages.ThermostatDataReply ,  handler: M1Control.prototype.updateThermostatTemperature}];

module.exports.M1Control = M1Control;
module.exports.Messages = controlMessages;