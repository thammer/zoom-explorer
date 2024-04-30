import { MIDIProxyForWebMIDIAPI } from "./MIDIProxyForWebMIDIAPI.js";
import { DeviceID, IMIDIProxy, MessageType } from "./midiproxy.js";
import { MIDIDeviceDescription, getMIDIDeviceList } from "./miditools.js";
import { getExceptionErrorString, toHexString } from "./tools.js";

function getZoomVersionNumber(versionBytes: [number, number, number, number]) : number
{
  let versionString = String.fromCharCode(...versionBytes);
  let versionFloat = parseFloat(versionString);
  return versionFloat;
}

function updateZoomDevicesTable(zoomDevices: MIDIDeviceDescription[]) {
  let midiDevicesTable: HTMLTableElement = document.getElementById("midiDevicesTable") as HTMLTableElement;

  for (let index = 0; index < zoomDevices.length; index++) {
    let device = zoomDevices[index];
    let version = getZoomVersionNumber(device.versionNumber);

    let row = midiDevicesTable.insertRow(1);
    let c;
    c = row.insertCell(-1); c.innerHTML = device.deviceName;
    c = row.insertCell(-1); c.innerHTML = version.toString();
    c = row.insertCell(-1); c.innerHTML = device.inputName;
    c = row.insertCell(-1); c.innerHTML = device.outputName;

    console.log(`  ${index + 1}: ${device.deviceName.padEnd(8)} OS v ${version} - input: ${device.inputName.padEnd(20)} output: ${device.outputName}`);
  };
}

/**
 * A temporary buffer for sending parameter values to the Zoom pedal
 * 
 * @example 
 * buffer[3]: deviceId
 * buffer[4]: command
 * 
 * @see https://github.com/g200kg/zoom-ms-utility/blob/master/midimessage.md
 * @see https://github.com/thammer/zoom-explorer/
 */
let zoomCommandTempBuffer = new Uint8Array([0xF0, 0x52, 0x00, 0xB3, 0xB4, 0xF7]); 

function sendZoomCommand(device: DeviceID, deviceId: number, command: number) : void
{
  let output = midi.getOutputInfo(device);
  if (output === undefined)
  {
    console.warn(`WARNING: Not sending MIDI message to device ${device} as the device is unknown"`);
    return;
  }
  if (output.connection != "open")
  {
    console.warn(`WARNING: Not sending MIDI message to device ${output.name} as the port is in state "${output.connection}"`);
    return;
  }

  zoomCommandTempBuffer[3] = deviceId & 0b01111111;
  zoomCommandTempBuffer[4] = command  & 0b01111111;

  try 
  {
    midi.send(device, zoomCommandTempBuffer);
  }
  catch (err) 
  {
    let message = getExceptionErrorString(err, `for device ${output.name}`);
    console.error(message);
  }
}

function updateMidiMonitorTable(device: MIDIDeviceDescription, data: Uint8Array, messageType: MessageType) {
  let command = data[0] >> 4;
  let color = ["#005500", "#00BB00", "#000000", "#550000", "#000000", "#000000", "#000000", "#000000",];
  let table: HTMLTableElement = document.getElementById("midiMonitorTable") as HTMLTableElement;
  let row = table.insertRow(1);
  let c;
  c = row.insertCell(-1); c.innerHTML = messageCounter.toString(); messageCounter++;
  c = row.insertCell(-1); c.innerHTML = device.deviceName;
  c = row.insertCell(-1); c.innerHTML = toHexString([data[0]]); c.style.color = color[command - 8];
  c = row.insertCell(-1); c.innerHTML = toHexString([data[1]]);
  c = row.insertCell(-1); c.innerHTML = toHexString([data[2]]); c.id = "value"; c.style.backgroundSize = (data[2] / 127 * 100) + "%";
  c = row.insertCell(-1); c.innerHTML = MessageType[messageType];
  c = row.insertCell(-1); c.innerHTML = data.length.toString();

  let documentHeight = Math.max(document.body.scrollHeight, document.body.offsetHeight,
    document.documentElement.clientHeight, document.documentElement.scrollHeight, document.documentElement.offsetHeight);

  // Remove old messages if table gets bigger than window. 
  if ((documentHeight > window.innerHeight) || (table.rows.length > 100)) {
    table.deleteRow(table.rows.length - 1);
  }
}

function toHexString2(bytes: Iterable<number> | ArrayLike<number>, separator: string = '') : string
{
  function addSentenceSpaces(lineString: string, sentenceLength: number)
  {
    let buildLineString = "";
    let linePos = 0;
    let lineStringLength = lineString.length;
    while (linePos + sentenceLength < lineStringLength) {
      buildLineString += lineString.substring(linePos, linePos + sentenceLength) + "&nbsp;&nbsp;&nbsp;";
      linePos += sentenceLength;
    }
    buildLineString += lineString.substring(linePos);
    return buildLineString;
  }

  let array = Array.from(bytes, byte => ('0' + (byte & 0xFF).toString(16).toUpperCase()).slice(-2));
  let string = array.join(" ");
  let stringBreak = "";
  let pos: number = 0;
  const breakLength = 50*3-1;
  const paragraphBreak = 4;
  const sentenceLength = 10*3
  
  let paragraph  = 0;
  while (pos + breakLength + 1 < string.length)
  {
    let lineString = string.substring(pos, pos + breakLength);
    let buildLineString = addSentenceSpaces(lineString, sentenceLength);
    stringBreak += buildLineString + "<br/>";
    pos += breakLength + 1;
    paragraph +=1;
    if (paragraph % paragraphBreak == 0)
    {
      stringBreak += "<br/>"
    }
  }

  stringBreak += addSentenceSpaces(string.substring(pos), sentenceLength);

  return stringBreak;
}

function updateSysexMonitorTable(device: MIDIDeviceDescription, data: Uint8Array)
{  
  let sysexDataCell: HTMLTableRowElement = document.getElementById("sysexDataCell") as HTMLTableRowElement;
  
  let dataset = sysexMap.get(data.length);
  if (dataset === undefined) 
  {
    sysexMap.set(data.length, { previous: data, current: data });      
  }
  else
  {
    sysexMap.set(data.length, { previous: dataset.current, current: data });      
  } 

  const sentenceLength = 10;
  const lineLength = 50;
  const paragraphHeight = 4;

  let sysexString = "";

  for (let [length, dataset] of sysexMap) 
  {
    sysexString += `<b>Data length: ${length}</b><br/>`
    for (let i=0; i<dataset.current.length; i++)
    {
      sysexString += toHexString([dataset.current[i]]);
      if ((i+1) % (paragraphHeight*lineLength) === 0)
        sysexString += "<br/><br/>";
      else if ((i+1) % lineLength === 0)
        sysexString += "<br/>";
      else if ((i+1) % sentenceLength === 0)
        sysexString += "&nbsp;&nbsp;";
      else
        sysexString += "&nbsp;";
    }
    if (dataset.current.length > lineLength)
      sysexString += "<br/><br/>";
    else
      sysexString += "<br/>";
  }

  sysexDataCell.innerHTML = sysexString;
}

function handleMIDIDataFromZoom(device: MIDIDeviceDescription, data: Uint8Array): void
{
  console.log(`Received MIDI message from ${device.deviceName.padEnd(25)}, length: ${data.length}, data: ${toHexString(data, " ")}`);

  let [messageType, channel, data1, data2] = midi.getChannelMessage(data); 

  updateMidiMonitorTable(device, data, messageType);

  if (messageType === MessageType.SysEx)
  {
    // let sysexDataCell: HTMLTableRowElement = document.getElementById("sysexDataCell") as HTMLTableRowElement;
    // let hexString = toHexString2(data);
    // sysexDataCell.innerHTML = hexString;
  
    updateSysexMonitorTable(device, data);
  }
}

async function start()
{
  let success = await midi.enable().catch( (reason) => {
    console.log(getExceptionErrorString(reason));
    return;
  });

  let midiDeviceList: MIDIDeviceDescription[] = await getMIDIDeviceList(midi, midi.inputs, midi.outputs, 100, true); 

  console.log("Got MIDI Device list:");
  for (let i=0; i<midiDeviceList.length; i++)
  {
    let device = midiDeviceList[i];
    console.log(`  ${JSON.stringify(device)}`)
  }

  let zoomDevices = midiDeviceList.filter( (device) => device.manufacturerID[0] === 0x52);

  updateZoomDevicesTable(zoomDevices);
  
  for (const device of zoomDevices)
  {
    await midi.openInput(device.inputID);
    await midi.openOutput(device.outputID);
  };

  for (const device of zoomDevices)
  {
    sendZoomCommand(device.outputID, device.familyCode[0], 0x50);
  }
  
  for (const device of zoomDevices)
  {
    midi.addListener(device.inputID, (deviceHandle, data) => {
      handleMIDIDataFromZoom(device, data);
    });
  };  
  
}

let messageCounter: number = 0;
let midi: IMIDIProxy = new MIDIProxyForWebMIDIAPI();
let sysexMap = new Map<number, {previous: Uint8Array, current: Uint8Array}>(); // map from data length to previous and current data, used for comparing messages

start();

