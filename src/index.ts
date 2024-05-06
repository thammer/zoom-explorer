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

function getZoomCommandName(data: Uint8Array) : string
{
  let name = data[4] === 0x00 ? "Identity" :
             data[4] === 0x28 ? "Send patch" :
             data[4] === 0x29 ? "Request current patch" :
             data[4] === 0x31 ? "Edit parameter" :
             data[4] === 0x32 ? "Store current patch" :
             data[4] === 0x33 ? "Request current program" :
             data[4] === 0x45 ? "MS+ Patch dump?" :
             data[4] === 0x50 ? "Parameter edit enable" :
             data[4] === 0x51 ? "Parameter edit disable" :
             data[4] === 0x64 && data[5] === 0x12 ? "MS+ Effect slot update" :
             data[4] === 0x64 && data[5] === 0x20 ? "MS+ Parameter update" :
             data[4] === 0x64 && data[5] === 0x26 ? "MS+ Bank and Program update" :
             "Unknown";
  return name;
}

function updateZoomDevicesTable(zoomDevices: MIDIDeviceDescription[]) {
  let midiDevicesTable: HTMLTableElement = document.getElementById("midiDevicesTable") as HTMLTableElement;

  for (let index = 0; index < zoomDevices.length; index++) {
    let device = zoomDevices[index];
    let version = getZoomVersionNumber(device.versionNumber);

    let row = midiDevicesTable.insertRow(1);
    let c;
    c = row.insertCell(-1); c.innerHTML = device.deviceName;
    c = row.insertCell(-1); c.innerHTML = toHexString([device.familyCode[0]]);
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
  let table: HTMLTableElement = document.getElementById("sysexMonitorTable") as HTMLTableElement;  
  
  let dataset = sysexMap.get(data.length);
  if (dataset === undefined) 
  {
    sysexMap.set(data.length, { previous: data, current: data, device: device, messageNumber: messageCounter });      
  }
  else
  {
    sysexMap.set(data.length, { previous: dataset.current, current: data, device: device, messageNumber: messageCounter });      
  } 

  const sentenceLength = 10;
  const lineLength = 50;
  const paragraphHeight = 4;

  let row;
  while (table.rows.length > 0) {
    table.deleteRow(0);
  }

  let checkboxCounter = 0;

  for (let [length, dataset] of sysexMap) 
  {
    let headerCell: HTMLTableCellElement;
    let bodyCell: HTMLTableCellElement;

    let dataType1 = toHexString([dataset.current[4]]);
    let dataType2 = toHexString([dataset.current[5]]);
    let dataTypeString = getZoomCommandName(dataset.current);
    row = table.insertRow(-1);
    headerCell = row.insertCell(-1); headerCell.innerHTML = `<b>Message #${dataset.messageNumber} from ${dataset.device.deviceName} [${toHexString([dataset.device.familyCode[0]])}]` +
        ` type "${dataTypeString}" [${dataType1} ${dataType2}] length ${length}</b> &nbsp;&nbsp;`;


    let current = dataset.current;
    let previous = dataset.previous;    
    let sysexString = generateHTMLSysexString(current, previous, paragraphHeight, lineLength, sentenceLength);
    row = table.insertRow(-1);
    bodyCell = row.insertCell(-1); bodyCell.innerHTML = sysexString; bodyCell.contentEditable = "plaintext-only";

    let button = document.createElement("button") as HTMLButtonElement;
    button.textContent = "Send";
    button.className = "sendSysexButton";
    button.addEventListener("click", (event) => {
      let html = bodyCell.innerHTML;
      let sysexData = html2Uint8Array(html);
      midi.send(dataset.device.outputID, sysexData);
    });
    headerCell.appendChild(button);

    let label = document.createElement("label") as HTMLLabelElement;
    label.className = "sysexASCIICheckbox";
    label.textContent = "ASCII ";
    label.htmlFor = "ASCIICheckbox_" + (checkboxCounter).toString();
    headerCell.appendChild(label);

    let input = document.createElement("input") as HTMLInputElement;
    input.type = "checkbox";
    input.className = "sysexASCIICheckbox";
    input.id = "ASCIICheckbox_" + (checkboxCounter).toString();
    input.addEventListener("click", (event) => {
      let useASCII = input.checked;

      let sysexString = generateHTMLSysexString(current, previous, paragraphHeight, lineLength, sentenceLength, useASCII);
      bodyCell.innerHTML = sysexString;   
    });
    headerCell.appendChild(input);

    checkboxCounter++;
  }
}

function html2Uint8Array(html: string) {
  let sysexString = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\r|\n/g, " "); // remove html tags, &nbsp, and newlines
  let sysexData = Uint8Array.from(sysexString.split(" ").filter(value => value.length === 2).map(value => parseInt(value, 16)));
  return sysexData;
}

function generateHTMLSysexString(current: Uint8Array, previous: Uint8Array, paragraphHeight: number, lineLength: number, sentenceLength: number, ascii: boolean = false) {
  let sysexString = "";
  for (let i = 0; i < current.length; i++) {
    let printableASCIIValue = current[i] >= 32 && current[i] <= 126 ? current[i] : 39; // printable or '
    let hexString = ascii ? `&#${printableASCIIValue};` : toHexString([current[i]]);
    //let hexString = String.fromCharCode(current[i]);
    if (previous[i] !== current[i])
      sysexString += "<b>" + hexString + "</b>";

    else
      sysexString += hexString;

    if ((i + 1) % (paragraphHeight * lineLength) === 0)
      sysexString += "<br/><br/>";
    else if ((i + 1) % lineLength === 0)
      sysexString += "<br/>";
    else if ((i + 1) % sentenceLength === 0)
      sysexString += "&nbsp;&nbsp;";
    else if (!ascii)
      sysexString += "&nbsp;";
  }
  return sysexString;
}

function handleMIDIDataFromZoom(device: MIDIDeviceDescription, data: Uint8Array): void
{
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

// map from data length to previous and current data, used for comparing messages
let sysexMap = new Map<number, {previous: Uint8Array, current: Uint8Array, device: MIDIDeviceDescription, messageNumber: number}>(); 

start();

