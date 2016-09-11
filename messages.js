"use strict";

function zeroPad(str, numDigits) {
	if (str.length < numDigits) {
		let origLen = str.length;
		for (let i = 0; i < (numDigits - origLen); ++i) {
			str = '0' + str;
		}
	}
	return str;
}

var ControlMessageType = {
	UNDEFINED : "undefined",
	ZONE_DEFINITION_REQUEST : "zd",
	ZONE_DEFINITION_REPLY : "ZD",
	ASCII_STRING_DEFINITION_REQUEST : "sd",
	ASCII_STRING_DEFINITION_REPLY : "SD",
	ZONE_CHANGE_UPDATE : "ZC"
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

function ControlRequest() {
	this.isRequest = true;
}

ControlRequest.prototype = new ControlMessage();
ControlRequest.prototype.constructor = ControlRequest;
ControlRequest.prototype.sendRawMessage=function(control) {
	if (!this.valid)
	{
		control.emit('diag', "Can't send invalid message." + this.rawMessage.toString());
		return;
	}

	control.sendRawDataToControl(this.rawMessage);
}

ControlRequest.prototype.request=function(control) {
	var promise = new Promise((resolve, reject) => {
		let replyMessageType = this.command.toString().toUpperCase();
		control.once(replyMessageType, (replyMessage) => {
			resolve(replyMessage);
		});
		this.sendToControl(control);
	});
	return promise;
}

function UpdateControlResult(result, reason) {
	return { result: result, reason: reason };
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
		control.emit('diag', "Invalid zone data.");
		return UpdateControlResult(false, "Invalid zone data.");
	}

	for (let i = 0; i < zoneData.length-2; ++i)
	{
		var zoneDef = ZoneDefinitionType[zoneData.charAt(i)];
		if (zoneDef && zoneDef.zoneType != 0) // Don't care about disabled zones
		{
			control.zones.push({ zoneId: i+1, zoneDefinition: zoneDef });
			//console.log("Zone " + (i+1) + " defined: " + zoneDef.zoneTypeDescription);
		}
	}

	return UpdateControlResult(true);
}

function ZoneDefinitionRequest(){
	this.command = ControlMessageType.ZONE_DEFINITION_REQUEST;
}
ZoneDefinitionRequest.prototype = new ControlRequest();
ZoneDefinitionRequest.prototype.constructor = ZoneDefinitionRequest;
ZoneDefinitionRequest.prototype.sendToControl=function(control) {
	var payload = this.command + "00"; // Add reserved bytes
	this.setMessage(payload);

	this.sendRawMessage(control);
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

function ASCIIStringDefinitionReply(){
	this.command = ControlMessageType.ASCII_STRING_DEFINITION_REPLY;
}
ASCIIStringDefinitionReply.prototype = new ControlMessage();
ASCIIStringDefinitionReply.prototype.constructor = ASCIIStringDefinitionReply;
ASCIIStringDefinitionReply.prototype.messageTypeString=function() {
	return "ASCII String Definition Reply";
}
ASCIIStringDefinitionReply.prototype.updateControl=function(control) {
	var definitionData = this.getPayload();
	
	var definitionType = parseInt(definitionData.substring(0,2));
	var definitionAddress = parseInt(definitionData.substring(2,5));

	var definitionString = definitionData.substring(5, definitionData.length-2).trim(); // Leave off the 00 reserved stuff

	//console.log("Type: " + definitionType + " Addr: " + definitionAddress + " String: " + definitionString);

	if (definitionType === ASCIIStringDefinitionType.ZONE_NAME.typeId) {
		for (let i = 0; i < control.zones.length; ++i) {
			if (definitionAddress === control.zones[i].zoneId) {
				control.zones[i].zoneName = definitionString;
				return UpdateControlResult(true);
			}
		}
	}

	return UpdateControlResult(false, "Control reply didn't match anything.");
}

function ASCIIStringDefinitionRequest(stringDefinitionType, definitionAddress){
	this.command = ControlMessageType.ASCII_STRING_DEFINITION_REQUEST;
	this.stringDefinitionType = stringDefinitionType;
	this.definitionAddress = definitionAddress;
}
ASCIIStringDefinitionRequest.prototype = new ControlRequest();
ASCIIStringDefinitionRequest.prototype.constructor = ASCIIStringDefinitionRequest;
ASCIIStringDefinitionRequest.prototype.sendToControl=function(control) {
	var typeStr = zeroPad(this.stringDefinitionType.typeId.toString(), 2);
	var addrStr = zeroPad(this.definitionAddress.toString(), 3);

	var payload = this.command + typeStr + addrStr + "00";
	this.setMessage(payload);

	this.sendRawMessage(control);
}

function createZoneStatus(id, description) {
	return { id: id, description: description };
}

var ZoneStatusHigh = {
	NORMAL : createZoneStatus(0b00, "Normal"),
	TROUBLE : createZoneStatus(0b01, "Trouble"),
	VIOLATED : createZoneStatus(0b10, "Violated"),
	BYPASSED : createZoneStatus(0b11, "Bypassed")
}

var ZoneStatusLow = {
	UNCONFIGURED : createZoneStatus(0b00, "Unconfigured"),
	OPEN : createZoneStatus(0b01, "Open"),
	EOL : createZoneStatus(0b10, "EOL"),
	SHORT : createZoneStatus(0b11, "Short")
}

function ZoneChangeUpdate(){
	this.command = ControlMessageType.ZONE_CHANGE_UPDATE;
}
ZoneChangeUpdate.prototype = new ControlMessage();
ZoneChangeUpdate.prototype.constructor = ZoneChangeUpdate;
ZoneChangeUpdate.prototype.messageTypeString=function() {
	return "Zone Change Update";
}

ZoneChangeUpdate.prototype.getZoneChangeInfo = function() {
	var zoneChangeInfo = this.getPayload();
	var zoneId = parseInt(zoneChangeInfo.substring(0,3));
	var zoneStatus = parseInt(zoneChangeInfo.substring(3,4), 16); // Hex value

	var lowNibble = zoneStatus & 0b0011; // Mask off the low nibble
	var highNibble = (zoneStatus & 0b1100) >> 2; // Mask off the high nibble

	var returnVal = { zoneId: zoneId, zoneStatusHigh: null, zoneStatusLow: null };

	var key = null;
	for (key in ZoneStatusHigh) {
		if (highNibble === ZoneStatusHigh[key].id) {
			returnVal.zoneStatusHigh = ZoneStatusHigh[key];
		}
	}
	for (key in ZoneStatusLow) {
		if (highNibble === ZoneStatusLow[key].id) {
			returnVal.zoneStatusLow = ZoneStatusLow[key];
		}
	}

	return returnVal;
}

// Only include types that the control sends back to us (no requests)
var ControlMessageConstructors = { };
ControlMessageConstructors[ControlMessageType.ZONE_DEFINITION_REPLY.toString()] = ZoneDefinitionReply;
ControlMessageConstructors[ControlMessageType.ASCII_STRING_DEFINITION_REPLY.toString()] = ASCIIStringDefinitionReply;
ControlMessageConstructors[ControlMessageType.ZONE_CHANGE_UPDATE.toString()] = ZoneChangeUpdate;

function ParseControlMessage(rawMessage) {
	var tempMessage = new ControlMessage();
	tempMessage.setRawMessage(rawMessage);

	if (!tempMessage.valid)
	{
		return tempMessage;
	}

	var finalMessage = tempMessage;

	var command = tempMessage.getCommand();
	if (ControlMessageConstructors.hasOwnProperty(command)) {
		finalMessage = new ControlMessageConstructors[command]();
		Object.assign(finalMessage, tempMessage);
	}

	return finalMessage;
}

module.exports = {
	// Enums
	ControlMessageType: ControlMessageType,
	ZoneDefinitionType: ZoneDefinitionType,
	ASCIIStringDefinitionType: ASCIIStringDefinitionType,
	ZoneStatusHigh: ZoneStatusHigh,
	ZoneStatusLow: ZoneStatusLow,

	// 'Types'
	ZoneChangeUpdate: ZoneChangeUpdate,
	ZoneDefinitionRequest: ZoneDefinitionRequest,
	ASCIIStringDefinitionRequest: ASCIIStringDefinitionRequest,

	// Factories
	ParseControlMessage: ParseControlMessage
};