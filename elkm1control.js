"use strict";
var net = require('net');

function zeroPad(str, numDigits) {
	if (str.length < numDigits) {
		let origLen = str.length;
		for (let i = 0; i < (numDigits - origLen); ++i) {
			str = '0' + str;
		}
	}
	return str;
}

function M1Control(){
	this.zones=[];
	this.controlMessageHandler = null;
}

var m1Control = new M1Control();

var ControlMessageType = {
	UNDEFINED : "undefined",
	ZONE_DEFINITION_REQUEST : "zd",
	ZONE_DEFINITION_REPLY : "ZD",
	ASCII_STRING_DEFINITION_REQUEST : "sd",
	ASCII_STRING_DEFINITION_REPLY : "SD"
};

function ControlMessage(){
	this.valid=false;
	this.rawMessage="unset";
}
ControlMessage.prototype.isValid=function() {
	return this.valid;
}
ControlMessage.prototype.calculateChecksum=function(msg) {
	var accumulator = 0;
	for (let i = 0; i < msg.length; ++i) {
		accumulator += msg.charCodeAt(i);
	}
	accumulator = (~accumulator + 1) & parseInt('ff', 16);
	var strChecksum = accumulator.toString(16).toUpperCase();
	if (strChecksum.length < 2) {
		strChecksum = '0' + strChecksum;
	}
	
	return strChecksum;
}
ControlMessage.prototype.verifyChecksum=function() {
	if (this.rawMessage.length <= 2)
		this.valid = false;
	//console.log('Raw length: ' + this.rawMessage.length);
	var rawChecksum = this.rawMessage.substr((this.rawMessage.length - 2)).toUpperCase();
	//console.log('Raw Checksum: ' + rawChecksum);
	var rawPayload = this.rawMessage.substr(0, this.rawMessage.length - 2);
	//console.log('Raw Payload: ' + rawPayload);
	var calcChecksum = this.calculateChecksum(rawPayload);
	if (rawChecksum === calcChecksum) {
		this.valid = true;
	}
}
ControlMessage.prototype.setRawMessage=function(message) {
	var tempMessage = message.toString();
	tempMessage = tempMessage.replace(/^\s+|\s+$/g, '');
	this.rawMessage = tempMessage;
	this.verifyChecksum();
}
ControlMessage.prototype.setMessage=function(message) {
	if (message.length >= 256)
		return;
	var hex = Number(message.length + 2).toString(16);
	if (hex.length < 2)
		hex = "0" + hex;

	var rawPayload = hex + message;
	this.rawMessage = rawPayload + this.calculateChecksum(rawPayload);
	this.valid = true;
}
ControlMessage.prototype.sendMessage=function(socket) {
	if (!this.valid)
	{
		console.log('Invalid message.');
		return;
	}

	console.log('Sending: ' + this.rawMessage);
	socket.write(this.rawMessage);
}
ControlMessage.prototype.getCommand=function() {
	if (!this.valid)
		return '';
	return this.rawMessage.substring(2,4);
}
ControlMessage.prototype.messageType=function(){
	if (this.hasOwnProperty('command'))
		return this.command;
	return ControlMessageType.UNDEFINED;
}
ControlMessage.prototype.messageTypeString=function() {
	return "Undefined";
}
ControlMessage.prototype.getPayload=function() {
	if (!this.valid)
	{
		return "";
	}
	return this.rawMessage.substring(4, this.rawMessage.length-2);  // Don't need the checksum on the end
}

var ZoneDefinitionType = {
	'0': { zoneTypeId: '0', zoneType:  0, zoneTypeDescription: "Disabled" },
	'1': { zoneTypeId: '1', zoneType:  1, zoneTypeDescription: "Burglar Entry/Exit 1" },
	'2': { zoneTypeId: '2', zoneType:  2, zoneTypeDescription: "Burglar Entry/Exit 2" },
	'3': { zoneTypeId: '3', zoneType:  3, zoneTypeDescription: "Burglar Perimeter Instant" },
	'4': { zoneTypeId: '4', zoneType:  4, zoneTypeDescription: "Burglar Interior" },
	'5': { zoneTypeId: '5', zoneType:  5, zoneTypeDescription: "Burglar Interior Follower" },
	'6': { zoneTypeId: '6', zoneType:  6, zoneTypeDescription: "Burglar Interior Night" },
	'7': { zoneTypeId: '7', zoneType:  7, zoneTypeDescription: "Burglar Interior Night Delay" },
	'8': { zoneTypeId: '8', zoneType:  8, zoneTypeDescription: "Burglar 24 Hour" },
	'9': { zoneTypeId: '9', zoneType:  9, zoneTypeDescription: "Burglar Box Tamper" },
	':': { zoneTypeId: ':', zoneType: 10, zoneTypeDescription: "Fire Alarm" },
	';': { zoneTypeId: ';', zoneType: 11, zoneTypeDescription: "Fire Verified" },
	'<': { zoneTypeId: '<', zoneType: 12, zoneTypeDescription: "Fire Supervisory" },
	'=': { zoneTypeId: '=', zoneType: 13, zoneTypeDescription: "Aux Alarm 1" },
	'>': { zoneTypeId: '>', zoneType: 14, zoneTypeDescription: "Aux Alarm 2" },
	'?': { zoneTypeId: '?', zoneType: 15, zoneTypeDescription: "Keyfob" },
	'@': { zoneTypeId: '@', zoneType: 16, zoneTypeDescription: "Non Alarm" },
	'A': { zoneTypeId: 'A', zoneType: 17, zoneTypeDescription: "Carbon Monoxide" },
	'B': { zoneTypeId: 'B', zoneType: 18, zoneTypeDescription: "Emergency Alarm" },
	'C': { zoneTypeId: 'C', zoneType: 19, zoneTypeDescription: "Freeze Alarm" },
	'D': { zoneTypeId: 'D', zoneType: 20, zoneTypeDescription: "Gas Alarm" },
	'E': { zoneTypeId: 'E', zoneType: 21, zoneTypeDescription: "Heat Alarm" },
	'F': { zoneTypeId: 'F', zoneType: 22, zoneTypeDescription: "Medical Alarm" },
	'G': { zoneTypeId: 'G', zoneType: 23, zoneTypeDescription: "Police Alarm" },
	'H': { zoneTypeId: 'H', zoneType: 24, zoneTypeDescription: "Police No Indication" },
	'I': { zoneTypeId: 'I', zoneType: 25, zoneTypeDescription: "Water Alarm" },
	'J': { zoneTypeId: 'J', zoneType: 26, zoneTypeDescription: "Key Momentary Arm / Disarm" },
	'K': { zoneTypeId: 'K', zoneType: 27, zoneTypeDescription: "Key Momentary Arm Away" },
	'L': { zoneTypeId: 'L', zoneType: 28, zoneTypeDescription: "Key Momentary Arm Stay" },
	'M': { zoneTypeId: 'M', zoneType: 29, zoneTypeDescription: "Key Momentary Disarm" },
	'N': { zoneTypeId: 'N', zoneType: 30, zoneTypeDescription: "Key On/Off" },
	'O': { zoneTypeId: 'O', zoneType: 31, zoneTypeDescription: "Mute Audibles" },
	'P': { zoneTypeId: 'P', zoneType: 32, zoneTypeDescription: "Power Supervisory" },
	'Q': { zoneTypeId: 'Q', zoneType: 33, zoneTypeDescription: "Temperature" },
	'R': { zoneTypeId: 'R', zoneType: 34, zoneTypeDescription: "Analog Zone" },
	'S': { zoneTypeId: 'S', zoneType: 35, zoneTypeDescription: "Phone Key" },
	'T': { zoneTypeId: 'T', zoneType: 36, zoneTypeDescription: "Intercom Key" }
};

function ZoneDefinitionReply(){
	this.command = ControlMessageType.ZONE_DEFINITION_REPLY;
}
ZoneDefinitionReply.prototype = new ControlMessage();
ZoneDefinitionReply.prototype.constructor = ZoneDefinitionReply;
ZoneDefinitionReply.prototype.messageTypeString=function() {
	return "Zone Definition Reply";
}
ZoneDefinitionReply.prototype.updateControl=function(control) {
	control.zones = []; // Clear
	var zoneData = this.getPayload();
	if (zoneData.length != 210)
	{
		// Zone definition must be 208 zones plus a reserved 00 sequence
		console.log("Invalid zone data.");
		return;
	}

	for (var i = 0; i < zoneData.length-2; ++i)
	{
		var zoneDef = ZoneDefinitionType[zoneData.charAt(i)];
		if (zoneDef && zoneDef.zoneType != 0) // Don't care about disabled zones
		{
			control.zones.push({ zoneId: i+1, zoneDefinition: zoneDef });
			console.log("Zone " + (i+1) + " defined: " + zoneDef.zoneTypeDescription);
		}
	}
}

function ZoneDefinitionRequest(){
	this.command = ControlMessageType.ZONE_DEFINITION_REQUEST;
}
ZoneDefinitionRequest.prototype = new ControlMessage();
ZoneDefinitionRequest.prototype.constructor = ZoneDefinitionRequest;
ZoneDefinitionRequest.prototype.send=function(socket) {
	var payload = this.command + "00";
	this.setMessage(payload);

	this.sendMessage(socket);
}
ZoneDefinitionRequest.prototype.request=function(socket, messageHandler) {
	var resolvePromise = null;
	var rejectPromise = null;
	var handleMessage = null;
	var receiveHandler = function(obj)
	{
		if (obj instanceof ZoneDefinitionReply)
		{
			handleMessage(obj);
		}
	}
	handleMessage = function(obj) {
		messageHandler.unsubscribe(receiveHandler);
		resolvePromise(obj);
	}
	var promise = new Promise(function(resolve, reject) {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	messageHandler.subscribe(receiveHandler);
	this.send(socket);
	return promise;
}

function createASCIIStringDefinitionType(typeNum, maxValue, stringDescription) {
	return { typeId:  typeNum, maxValue: maxValue, stringDefinitionTypeDescription: stringDescription };
}

var ASCIIStringDefinitionType = {
	ZONE_NAME 			: createASCIIStringDefinitionType( 0, 208, "Zone Name"),
	AREA_NAME 			: createASCIIStringDefinitionType( 1,   8, "Area Name"),
	USER_NAME 			: createASCIIStringDefinitionType( 2,   1, "User Name"),
	KEYPAD_NAME 		: createASCIIStringDefinitionType( 3,   1, "Keypad Name"),
	OUTPUT_NAME         : createASCIIStringDefinitionType( 4,   1, "Output Name"),
	TASK_NAME           : createASCIIStringDefinitionType( 5,   1, "Task Name"),
	TELEPHONE_NAME      : createASCIIStringDefinitionType( 6,   1, "Telephone Name"),
	LIGHT_NAME          : createASCIIStringDefinitionType( 7,   1, "Light Name"),
	ALARM_DURATION_NAME : createASCIIStringDefinitionType( 8,   1, "Alarm Duration Name"),
	CUSTOM_SETTING_NAME : createASCIIStringDefinitionType( 9,   1, "Custom Setting Name"),
	COUNTER_NAME 		: createASCIIStringDefinitionType(10,   1, "Counter Name"),
	THERMOSTAT_NAME 	: createASCIIStringDefinitionType(11,   1, "Thermostat Name"),
	FKEY1_NAME 			: createASCIIStringDefinitionType(12,   1, "FKey 1 Name"),
	FKEY2_NAME 			: createASCIIStringDefinitionType(13,   1, "FKey 2 Name"),
	FKEY3_NAME 			: createASCIIStringDefinitionType(14,   1, "FKey 3 Name"),
	FKEY4_NAME 			: createASCIIStringDefinitionType(15,   1, "FKey 4 Name"),
	FKEY5_NAME 			: createASCIIStringDefinitionType(16,   1, "FKey 5 Name"),
	FKEY6_NAME 			: createASCIIStringDefinitionType(17,   1, "FKey 6 Name"),
	AUDIO_ZONE_NAME 	: createASCIIStringDefinitionType(18,   1, "Audio Zone Name"),
	AUDIO_SOURCE_NAME 	: createASCIIStringDefinitionType(19,   1, "Audio Source Name")
};

function ASCIIStringDefinitionRequest(stringDefinitionType, definitionAddress){
	this.command = ControlMessageType.ASCII_STRING_DEFINITION_REQUEST;
	this.stringDefinitionType = stringDefinitionType;
	this.definitionAddress = definitionAddress;
}
ASCIIStringDefinitionRequest.prototype = new ControlMessage();
ASCIIStringDefinitionRequest.prototype.constructor = ASCIIStringDefinitionRequest;
ASCIIStringDefinitionRequest.prototype.send=function(socket) {
	if (!this.stringDefinitionType)
		return;

	var typeStr = zeroPad(this.stringDefinitionType.typeId.toString(), 2);
	var addrStr = zeroPad(this.definitionAddress.toString(), 3);

	var payload = this.command + typeStr + addrStr + "00";
	this.setMessage(payload);

	this.sendMessage(socket);
}

function ControlMessageHandler(){
	this.listeners = [];
}
ControlMessageHandler.prototype.subscribe = function(fn) {
    this.listeners.push(fn);
}
 
ControlMessageHandler.prototype.unsubscribe = function(fn) {
    this.listeners = this.listeners.filter(
        function(item) {
            if (item !== fn) {
                return item;
            }
        }
    );
}
 
ControlMessageHandler.prototype.fire = function(o) {
    this.listeners.forEach(function(item) {
        item.call(null, o);
    });
}

ControlMessageHandler.prototype.handleMessage = function(rawMessage) {
	var tempMessage = new ControlMessage();
	tempMessage.setRawMessage(rawMessage);

	if (!tempMessage.valid)
	{
		console.log("Invalid message received: " + tempMessage.rawMessage);
		return;
	}

	var finalMessage = tempMessage;

	var command = tempMessage.getCommand();
	if (command === ControlMessageType.ZONE_DEFINITION_REPLY)
	{
		finalMessage = new ZoneDefinitionReply();
		Object.assign(finalMessage, tempMessage);
	}

	if (finalMessage.messageType() === ControlMessageType.UNDEFINED)
	{
		console.log("Undefined message type received: " + finalMessage.rawMessage);
		return;
	}

	//console.log("Message Received: " + finalMessage.messageTypeString() + " RawMessage: " + finalMessage.rawMessage);
	this.fire(finalMessage);
}

m1Control.controlMessageHandler = new ControlMessageHandler();

var client = new net.Socket();
client.connect(2101, '10.0.1.55', function() {
	console.log('Connected');
	//client.write('Hello, server! Love, Client.');

	var zd = new ZoneDefinitionRequest();
	//zd.send(client);
	zd.request(client, m1Control.controlMessageHandler).then(function(obj) { obj.updateControl(m1Control); var sd = new ASCIIStringDefinitionRequest(ASCIIStringDefinitionType.ZONE_NAME, 1);  sd.send(client); });
});

client.on('data', function(data) {
	m1Control.controlMessageHandler.handleMessage(data);
});

client.on('close', function() {
	console.log('Connection closed');
});