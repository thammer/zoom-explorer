import { MIDIProxyForWebMIDIAPI } from "./MIDIProxyForWebMIDIAPI.js";
import { DeviceID, IMIDIProxy, MessageType } from "./midiproxy.js";
import { MIDIDeviceDescription, getMIDIDeviceList } from "./miditools.js";
import { getExceptionErrorString, partialArrayMatch, toHexString, toUint8Array } from "./tools.js";
import { decodeWFP, encodeWFP, WFPPayloadType } from "./wfp.js";
import { ZoomPatch } from "./ZoomPatch.js";

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
  messageCounter++;
  c = row.insertCell(-1); c.innerHTML = messageCounter.toString();
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

function seven2eight(sevenBitBytes: Uint8Array, start: number = 0, end: number = -1) : Uint8Array
{
  if (end === -1)
    end = sevenBitBytes.length - 1;

  // let eightBitBytes: Uint8Array = new Uint8Array(end - start + 1); // FIXME: we don't need all this space. Calculate.
  let remainder = (end - start + 1) % 8;
  if (remainder === 1)
  {
    console.error(`remainder === 1. Illegal encoding for array of seven bit bytes of length ${sevenBitBytes.length}. Ignoring last seven bit byte`);
  }
  let eightBitBytes: Uint8Array = new Uint8Array( Math.floor((end - start + 1) / 8) * 7 + (remainder < 2 ? 0 : remainder - 1 ) );

  let eightIndex = 0;
  let bitIndex;
  let seven;
  let highBits: number = 0;
  let sevenIndex = start;
  
  while (sevenIndex <= end) {
    seven = sevenBitBytes[sevenIndex];
    bitIndex = 7 - (sevenIndex - start) % 8;
    if (bitIndex == 7)
      highBits = seven;
    else {
      eightBitBytes[eightIndex++] = seven + (((highBits >> bitIndex) & 1) << 7);
    }

    sevenIndex++;
  }

  return eightBitBytes;
}

function getChildWithIdThatStartsWith(children: HTMLCollection, startsWidth: string) : HTMLElement | null
{
  let index = 0;
  while (index < children.length) {
    let item = children.item(index++) as HTMLElement;
    if (item.id.startsWith(startsWidth))
      return item;
  }
  return null;
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

  let row: HTMLTableRowElement;
  // while (table.rows.length > 0) {
  //   table.deleteRow(0);
  // }

  let cellCounter = 0;

  for (let [length, dataset] of sysexMap) 
  {
    let headerCell: HTMLTableCellElement;
    let bodyCell: HTMLTableCellElement;

    let dataType1 = toHexString([dataset.current[4]]);
    let dataType2 = toHexString([dataset.current[5]]);
    let dataTypeString = getZoomCommandName(dataset.current);

    let updatedRow = false;
    let rowId = `Sysex_Row_Header_${length}`;
    row = document.getElementById(rowId) as HTMLTableRowElement;
    if (row === null) {
      updatedRow = true;
      row = table.insertRow(-1);
      row.id = rowId;
      headerCell = row.insertCell(-1);

      let headerSpan = document.createElement("span");
      headerSpan.id = "sysexHeader_" + (cellCounter).toString();
      headerCell.appendChild(headerSpan);

      let button = document.createElement("button") as HTMLButtonElement;
      button.textContent = "Send";
      button.className = "sendSysexButton";
      button.addEventListener("click", (event) => {
        let html = bodyCell.innerHTML;
        let sysexData = html2Uint8Array(html);
        midi.send(dataset.device.outputID, sysexData);
      });
      headerCell.appendChild(button);
  
      let inputEightBitOffset = document.createElement("input") as HTMLInputElement;
      inputEightBitOffset.type = "text";
      inputEightBitOffset.className = "sysexEightBitOffset";
      inputEightBitOffset.id = "eightBitOffset_" + (cellCounter).toString();
      inputEightBitOffset.size = 4;
      inputEightBitOffset.maxLength = 4;
      inputEightBitOffset.addEventListener("click", (event) => {
        let useASCII = inputASCII.checked;
        let useEightBit = inputEightBit.checked;
        let eightBitOffset = inputEightBitOffset.value != null ? parseFloat(inputEightBitOffset.value) : 0;
  
        let sysexString = generateHTMLSysexString(current, previous, paragraphHeight, lineLength, sentenceLength, useASCII, useEightBit, eightBitOffset);
        bodyCell.innerHTML = sysexString;   
      });
      headerCell.appendChild(inputEightBitOffset);
  
      let label = document.createElement("label") as HTMLLabelElement;
      label.className = "sysexEightBitOffset";
      label.textContent = "offset ";
      label.htmlFor = "eightBitOffset_" + (cellCounter).toString();
      headerCell.appendChild(label);
  
      label = document.createElement("label") as HTMLLabelElement;
      label.className = "sysexEightBitCheckbox";
      label.textContent = "8 bit ";
      label.htmlFor = "EightBitCheckbox_" + (cellCounter).toString();
      headerCell.appendChild(label);
  
      let inputEightBit = document.createElement("input") as HTMLInputElement;
      inputEightBit.type = "checkbox";
      inputEightBit.className = "sysexEightBitCheckbox";
      inputEightBit.id = "eightBitCheckbox_" + (cellCounter).toString();
      inputEightBit.addEventListener("click", (event) => {
        let useASCII = inputASCII.checked;
        let useEightBit = inputEightBit.checked;
        let eightBitOffset = inputEightBitOffset.value != null ? parseFloat(inputEightBitOffset.value) : 0;
  
        let sysexString = generateHTMLSysexString(current, previous, paragraphHeight, lineLength, sentenceLength, useASCII, useEightBit, eightBitOffset);
        bodyCell.innerHTML = sysexString;   
      });
      headerCell.appendChild(inputEightBit);
  
      label = document.createElement("label") as HTMLLabelElement;
      label.className = "sysexASCIICheckbox";
      label.textContent = "ASCII ";
      label.htmlFor = "ASCIICheckbox_" + (cellCounter).toString();
      headerCell.appendChild(label);
  
      let inputASCII = document.createElement("input") as HTMLInputElement;
      inputASCII.type = "checkbox";
      inputASCII.className = "sysexASCIICheckbox";
      inputASCII.id = "ASCIICheckbox_" + (cellCounter).toString();
      inputASCII.addEventListener("click", (event) => {
        let useASCII = inputASCII.checked;
        let useEightBit = inputEightBit.checked;
        let eightBitOffset = inputEightBitOffset.value != null ? parseFloat(inputEightBitOffset.value) : 0;
  
        let sysexString = generateHTMLSysexString(current, previous, paragraphHeight, lineLength, sentenceLength, useASCII, useEightBit, eightBitOffset);
        bodyCell.innerHTML = sysexString;   
      });
      headerCell.appendChild(inputASCII);
  
      cellCounter++;

    } else {
      headerCell = row.cells[0];
    }

    let headerSpan = getChildWithIdThatStartsWith(headerCell.children, "sysexHeader") as HTMLSpanElement;
    headerSpan.innerHTML = `<b>Message #${dataset.messageNumber} from ${dataset.device.deviceName} [${toHexString([dataset.device.familyCode[0]])}]` +
    ` type "${dataTypeString}" [${dataType1} ${dataType2}] length ${length}</b> &nbsp;&nbsp;`;

    let current = dataset.current;
    let previous = dataset.previous;    

    let inputASCII = getChildWithIdThatStartsWith(headerCell.children, "ASCIICheckbox") as HTMLInputElement;
    let inputEightBit = getChildWithIdThatStartsWith(headerCell.children, "eightBitCheckbox") as HTMLInputElement;
    let inputEightBitOffset = getChildWithIdThatStartsWith(headerCell.children, "eightBitOffset") as HTMLInputElement;
    let useASCII = inputASCII.checked;
    let useEightBit = inputEightBit.checked;
    let eightBitOffset = inputEightBitOffset.value != null ? parseFloat(inputEightBitOffset.value) : 0;

    if (current.length === 985 || current.length === 989) {
      let offset = 9 + current.length - 985;
      let eightBitCurrent = seven2eight(current, offset, current.length-2);

      let patch = ZoomPatch.fromPatchData(eightBitCurrent);
      console.log(`Patch name: ${patch.name}`);
    }

    let sysexString = generateHTMLSysexString(current, previous, paragraphHeight, lineLength, sentenceLength, useASCII, useEightBit, eightBitOffset);

    rowId = `Sysex_Row_Body_${length}`;
    row = document.getElementById(rowId) as HTMLTableRowElement;
    if (row === null) {
      row = table.insertRow(-1);
      row.id = rowId;
      bodyCell = row.insertCell(-1);
    } else {
      bodyCell = row.cells[0];
    }

    bodyCell.innerHTML = sysexString; bodyCell.contentEditable = "plaintext-only";

  }
}

function html2Uint8Array(html: string) {
  let sysexString = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\r|\n/g, " "); // remove html tags, &nbsp;, and newlines
  let sysexData = Uint8Array.from(sysexString.split(" ").filter(value => value.length === 2).map(value => parseInt(value, 16)));
  return sysexData;
}



function generateHTMLSysexString(current: Uint8Array, previous: Uint8Array, paragraphHeight: number, lineLength: number, sentenceLength: number, 
                                 ascii: boolean = false, eightBit: boolean = false, eightBitOffset: number = 0) 
{
  if (eightBit) {
    let lastByte = current[current.length - 1];
    let sliceBeforeOffset = current.slice(0, eightBitOffset);
    let eightBitCurrent = seven2eight(current, eightBitOffset, current.length-2);
    current = new Uint8Array(eightBitOffset + eightBitCurrent.length + 1);
    current.set(sliceBeforeOffset);
    current.set(eightBitCurrent, eightBitOffset);
    current.set(new Uint8Array([lastByte]), current.length - 1);

    lastByte = previous[previous.length - 1];
    sliceBeforeOffset = previous.slice(0, eightBitOffset);
    let eightBitPrevious = seven2eight(previous, eightBitOffset, previous.length-2);
    previous = new Uint8Array(eightBitOffset + eightBitPrevious.length + 1);
    previous.set(sliceBeforeOffset);
    previous.set(eightBitPrevious, eightBitOffset);
    previous.set(new Uint8Array([lastByte]), previous.length - 1);
  }

  let sysexString = "";
  for (let i = 0; i < current.length; i++) {
    let printableASCIIValue = current[i] >= 32 && current[i] <= 126 ? current[i] : current[i] == 0 ? 95 : 39; // printable, _ or '
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
    // let hexString = toHexString2(data, " ");
    // sysexDataCell.innerHTML = hexString;
  
    updateSysexMonitorTable(device, data);
  }
}


function sleepForAWhile(timeoutMilliseconds: number)
{
  return new Promise( (resolve) => 
  {
    setTimeout(() =>
    {
      resolve("Timed out");
    }, timeoutMilliseconds);
  });
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
      console.log(`Received: ${toHexString(data, " ")}`);
      handleMIDIDataFromZoom(device, data);
    });
  };  

  // let callAndResponse = new Map<string, string>();
  // let commandIndex = 0x50;
  // let device = zoomDevices[0];
  // midi.addListener(device.inputID, (deviceHandle, data) => {
  //   let call = toHexString([commandIndex]);
  //   let response = toHexString(data, " ");
  //   callAndResponse.set(call, response);
  //   console.log(`${call} -> ${response}`)
  // });
  // let testButton: HTMLButtonElement = document.getElementById("testButton") as HTMLButtonElement;
  // testButton.addEventListener("click", (event) => {
  //   commandIndex++;
  //   sendZoomCommand(device.outputID, device.familyCode[0], commandIndex);
  // });

  let testButton: HTMLButtonElement = document.getElementById("testButton") as HTMLButtonElement;
  testButton.addEventListener("click", async (event) => {
    
    // test wpf stuff

    function isMIDIIdentityResponse(data: Uint8Array) : boolean
    {
      return (data.length >= 15 && data[0] == 0xF0 && data[1] == 0x7E && data[3] == 0x06 && data[4] == 0x02 && 
        ( (data[5] !== 0 && data.length == 15 && data[14] == 0xF7) || (data[5] == 0 && data.length == 17 && data[16] == 0xF7) ) );
    }

    let map = new Map<string, Uint8Array>(); 
    let device = zoomDevices[0];

    let data = await midi.sendAndGetReply(device.outputID, new Uint8Array([0xf0,0x7e,0x7f,0x06,0x01,0xf7]), device.inputID, isMIDIIdentityResponse, 100); 
    console.log(`Received data: ${data?.length}`);
    if (data == undefined)
      return;
    map.set("SIRX", data); 

    let requestPatch = toUint8Array("F0 52 00 6E 64 13 F7");
    map.set("SPTX", requestPatch); 

    data = await midi.sendAndGetReply(device.outputID, requestPatch, device.inputID, 
      (received) => partialArrayMatch(received, toUint8Array("F0 52 00 6E 64 12")), 1000); 
    console.log(`Received data: ${data?.length}`);
    if (data == undefined)
      return;
    map.set("SPRX", data); 

    let wfp = await encodeWFP(map, WFPPayloadType.GzipB64URL);
    console.log(`WFP: "${wfp}"`);
    let map2 = await decodeWFP(wfp);
    console.log(`Decoded WFP data length: ${map2.get("SIRX")?.length}`)

  //   let sysexStringListFiles = "F0 52 00 6E 60 25 00 00 2a 2e 2a 00 F7";
  //   let sysexDataListFiles = Uint8Array.from(sysexStringListFiles.split(" ").filter(value => value.length === 2).map(value => parseInt(value, 16)));
  
  //   let sysexStringGetNextFile = "F0 52 00 6E 60 26 00 00 2a 2e 2a 00 F7";
  //   let sysexDataGetNextFile = Uint8Array.from(sysexStringGetNextFile.split(" ").filter(value => value.length === 2).map(value => parseInt(value, 16))); 
  
  //   let device = zoomDevices[0];
  //   midi.addListener(device.inputID, (deviceHandle, data) => {
  //     let response = toHexString(data, " ");
  //     console.log(`${sysexStringGetNextFile} -> ${response}`)
  //   });

  //   await sleepForAWhile(100);
  //   midi.send(device.outputID, sysexDataListFiles);

  //   for (let i=0; i<300; i++) {
  //     await sleepForAWhile(100);
  //     midi.send(device.outputID, sysexDataGetNextFile);
  //   }

  //   await sleepForAWhile(100);
  //   let sysexStringEndFileListing = "F0 52 00 6E 60 27 F7";
  //   let sysexDataEndFileListing = Uint8Array.from(sysexStringEndFileListing.split(" ").filter(value => value.length === 2).map(value => parseInt(value, 16)));
  //   midi.send(device.outputID, sysexDataEndFileListing);
 });
}

let seven=toUint8Array("01 02 03 04 05 06 07 08");
let eight = seven2eight(seven);

console.log(`Eight: ${toHexString(eight, " ")}`);

// toHexString(seven2eight(toUint8Array("01 02 03 04 05 06 07 08")), " ");

let messageCounter: number = 0;
let midi: IMIDIProxy = new MIDIProxyForWebMIDIAPI();

// map from data length to previous and current data, used for comparing messages
let sysexMap = new Map<number, {previous: Uint8Array, current: Uint8Array, device: MIDIDeviceDescription, messageNumber: number}>(); 

start();

