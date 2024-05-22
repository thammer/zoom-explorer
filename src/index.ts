import { MIDIProxyForWebMIDIAPI } from "./MIDIProxyForWebMIDIAPI.js";
import { DeviceID, IMIDIProxy, MessageType } from "./midiproxy.js";
import { MIDIDeviceDescription, getMIDIDeviceList, isMIDIIdentityResponse } from "./miditools.js";
import { getExceptionErrorString, partialArrayMatch, toHexString, toUint8Array, getNumberFromBits } from "./tools.js";
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
    c = row.insertCell(-1); c.innerHTML = toHexString(device.identityResponse, " ");

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

      // F0 52 00 6E 46 00 00 01 00 01 00 F7
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

    if (data.length > 10 && ((data[4] == 0x64 && data[5] == 0x12) || (data[4] == 0x45 && data[5] == 0x00)) ) {
      let offset = 9 + data.length - 985;
      let eightBitData = seven2eight(data, offset, data.length-2);

      let patch = ZoomPatch.fromPatchData(eightBitData);

      updatePatchInfoTable(patch);
    }
    else if (data.length === 15 && (data[4] == 0x64 && data[5] == 0x20)) {
      // Parameter was edited on device
      // Request patch immediately
      midi.send(device.outputID, toUint8Array("F0 52 00 6E 64 13 F7"));
    }

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

async function getCurrentPatch(zoomDevices: MIDIDeviceDescription[])
{
  let map = new Map<string, Uint8Array>();
  let device = zoomDevices[0];

  let data = await midi.sendAndGetReply(device.outputID, new Uint8Array([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]), device.inputID, isMIDIIdentityResponse, 100);
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
  console.log(`Decoded WFP data length: ${map2.get("SIRX")?.length}`);
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

  function togglePatchesTablePatch(cell: HTMLTableCellElement)
  {
    let cellNumber = parseInt(cell.id);
    if (cellNumber === undefined)
      return;
    let row = cell.parentElement as HTMLTableRowElement;
    if (row === null)
      return;
    let column = Math.floor(cellNumber / 2);
    row.cells[column * 2].classList.toggle("highlight");
    row.cells[column * 2 + 1].classList.toggle("highlight");
  }

  function getPatchNumber(cell: HTMLTableCellElement) : number
  {
    let cellNumber = parseInt(cell.id);
    if (cellNumber === undefined)
      return -1;
    let row = cell.parentElement as HTMLTableRowElement;
    if (row === null)
      return -1;
    let column = Math.floor(cellNumber / 2);
    let text = row.cells[column * 2].textContent;
    if (text === null)
      return -1;
    return parseInt(text);
  }

  let zoomPatches : Array<ZoomPatch>;

  let lastSelected : HTMLTableCellElement | null = null;
  let patchesTable = document.getElementById("patchesTable") as HTMLTableElement;
  patchesTable.addEventListener("click", (event) => {
    if (event.target == null)
      return;
    let cell = event.target as HTMLTableCellElement;
    togglePatchesTablePatch(cell);

    if (lastSelected != null)
      togglePatchesTablePatch(lastSelected);

    lastSelected = cell;

    let patchNumber = getPatchNumber(cell) - 1;
    console.log(`Patch number clicked: ${patchNumber}`);

    // update patch info table

    let patch = zoomPatches[patchNumber];

    updatePatchInfoTable(patch);

  });

  let testButton: HTMLButtonElement = document.getElementById("testButton") as HTMLButtonElement;
  testButton.addEventListener("click", async (event) => {
    
    // await getCurrentPatch(zoomDevices);

    let headerRow = patchesTable.rows[0];
    let numColumns = headerRow.cells.length / 2;

    let device = zoomDevices[0];
  
    let maxNumPatches = 500;
    zoomPatches = new Array<ZoomPatch>(maxNumPatches);
    for (let i=0; i<maxNumPatches; i++) {
      let bank = Math.floor(i/10);
      let program = i % 10;
      let requestPatch = toUint8Array(`F0 52 00 6E 46 00 00 ${toHexString([bank])} 00 ${toHexString([program])} 00 F7`);
      let data = await midi.sendAndGetReply(device.outputID, requestPatch, device.inputID,
        (received) => partialArrayMatch(received, toUint8Array("F0 52 00 6E 45 00")), 1000);
      if (data == undefined) {
        console.log(`Got no reply for patch number ${i}`);
        zoomPatches.splice(i);
        break;
      }
      console.log(`Received data: ${data.length}`);

      let offset = 9 + data.length - 985;
      let eightBitData = seven2eight(data, offset, data.length-2);

      let patch = ZoomPatch.fromPatchData(eightBitData);
      zoomPatches[i] = patch;
    }

    let numPatchesPerRow = Math.ceil(zoomPatches.length / numColumns);

    for (let i=patchesTable.rows.length - 1; i<numPatchesPerRow; i++) {
      let row = patchesTable.insertRow(-1);
      for (let c=0; c<numColumns * 2; c++) {
        let cell = row.insertCell(-1);
        cell.id = `${c}`;
      }
    }

    let row: HTMLTableRowElement;
    let bodyCell: HTMLTableCellElement;
    for (let i=0; i<zoomPatches.length; i++) {
      let patch = zoomPatches[i];
      row = patchesTable.rows[1 + i % numPatchesPerRow];
      bodyCell = row.cells[Math.floor(i/numPatchesPerRow) * 2];
      bodyCell.innerHTML = `${i + 1}`;
      bodyCell = row.cells[Math.floor(i/numPatchesPerRow) * 2 + 1];
      let name = patch.longName != null ? patch.longName : patch.name;
      bodyCell.innerHTML = `${name}`;
    }

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

let previousPatchInfoString = ""; 

function updatePatchInfoTable(patch: ZoomPatch) {
  let patchTable = document.getElementById("patchTable") as HTMLTableElement;

  let headerCell = patchTable.rows[0].cells[0];
  let bodyCell = patchTable.rows[1].cells[0];

  let patchNameString = "";
  if (patch.name !== null)
    patchNameString = patch.name.trim();

  let idString = "";
  if (patch.ids !== null) {
    for (let i = 0; i < patch.ids.length; i++)
      idString += `${patch.ids[i].toString(16).toUpperCase().padStart(8, "0")} `;
    if (idString.length > 1)
      idString = idString.slice(0, idString.length - 1);
  };

  let unknownString = "";
  if (patch.ptcfUnknown !== null) {
    for (let i = 0; i < patch.ptcfUnknown.length; i++)
      unknownString += `${patch.ptcfUnknown[i].toString(16).toUpperCase().padStart(2, "0")} `;
    if (unknownString.length > 1)
      unknownString = unknownString.slice(0, unknownString.length - 1);
  };

  let targetString = "";
  if (patch.target !== null) {
    targetString = patch.target.toString(2).padStart(32, "0");
    targetString = targetString.slice(0, 8) + " " + targetString.slice(8, 16) + " " + targetString.slice(16, 24) + " " + targetString.slice(24, 32);
  }

  headerCell.innerHTML = `Patch: "${patchNameString}". Version: ${patch.version}. Target: ${targetString}. Unknown: ${unknownString}. Length: ${patch.length}<br/>` +
    `Effects: ${patch.numEffects}. IDs: ${idString}.`;

  // TXJ1
  unknownString = "";
  if (patch.txj1DescriptionJapanese !== null) {
    for (let i = 0; i < patch.txj1DescriptionJapanese.length; i++) {
      if ((i > 0) && (i % 32 == 0))
        unknownString += "<br/>                           ";
      unknownString += `${patch.txj1DescriptionJapanese[i].toString(16).toUpperCase().padStart(2, "0")} `;
    }
  };
  let txj1String = `${patch.TXJ1} Length: ${patch.txj1Length?.toString().padStart(3, " ")}  Unknown: ${unknownString}`;

  // TXE1
  let txe1String = `${patch.TXE1} Length: ${patch.txe1Length?.toString().padStart(3, " ")}  Description: "${patch.txe1DescriptionEnglish}"`;

  // EDTB
  let effectSettingsString = "";
  if (patch.edtbUnknown !== null && patch.ids !== null && patch.edtbEffectSettings !== null) {
    for (let i = 0; i < patch.edtbUnknown.length; i++) {
      let effectSettings = patch.edtbEffectSettings[i];
      let parameterString = ""; 
      for (let p=0; p<effectSettings.parameters.length; p++) {
        parameterString += effectSettings.parameters[p].toString().toUpperCase().padStart(4, " ") + " ";
      }
      effectSettingsString += `     Effect ID: ${patch.ids[i].toString(16).toUpperCase().padStart(8, "0")}  Settings: ${effectSettings.enabled ? "[ ON]" : "[OFF]"}  `;
      effectSettingsString += `ID: ${effectSettings.id.toString(16).toUpperCase().padStart(8, "0")}  Parameters: ${parameterString}<br/>`;
      effectSettingsString += `                          Unknown: `;
      let effect = patch.edtbUnknown[i];
      for (let p = 0; p < effect.length - Math.ceil(90/8 + 5) + 3; p++) {
        effectSettingsString += `${effect[p].toString(2).padStart(8, "0")} `;
        if (((p + 1) % 12 == 0) && (p + 1 < effect.length))
          effectSettingsString += "<br/>                                   ";
      }
      effectSettingsString += "<br/><br/>";
    }
    if (effectSettingsString.length > 1)
      effectSettingsString = effectSettingsString.slice(0, effectSettingsString.length - 5 * 2);
  };
  let edtbString = `${patch.EDTB} Length: ${patch.edtbLength?.toString().padStart(3, " ")}<br/>` + effectSettingsString;

  // PRM2
  unknownString = "";
  let tempoString = "";
  let editEffectSlotString = "";
  let driveString = "";
  if (patch.prm2Unknown !== null) {
    for (let i = 0; i < patch.prm2Unknown.length; i++) {
      if ((i > 0) && (i % 32 == 0))
        unknownString += "<br/>                           ";
      unknownString += `${patch.prm2Unknown[i].toString(16).toUpperCase().padStart(2, "0")} `;
    }
    if (patch.prm2Unknown.length > 2)
      tempoString = `${patch.prm2Tempo?.toString().padStart(3)}`;
    if (patch.prm2Unknown.length > 12)
      editEffectSlotString = `${patch.prm2Unknown[10].toString(2).padStart(8, "0")} ${patch.prm2Unknown[11].toString(2).padStart(8, "0")} ${patch.prm2Unknown[12].toString(2).padStart(8, "0")} `;
    if (patch.prm2Unknown.length > 20)
      driveString = `${patch.prm2Unknown[20].toString(2).padStart(8, "0")}`;
  };
  let prm2String = `${patch.PRM2} Length: ${patch.prm2Length?.toString().padStart(3, " ")}  Tempo: ${tempoString}  Edit effect slot: ${editEffectSlotString}  First slot with drive: ${driveString}<br/>` + 
    `                  Unknown: ${unknownString}`;

  // NAME
  let nameString = `${patch.NAME} Length: ${patch.nameLength?.toString().padStart(3, " ")}  Name: "${patch.longName}"`;

  let patchInfoString = nameString + "<br/>" + txe1String + "<br/>" + prm2String + "<br/>" + txj1String + "<br/>" + edtbString; 
  let htmlPatchInfoString = "";
  
  if (patchInfoString.length === previousPatchInfoString.length) {
    let first = 0;
    let last = 0;
    for (let i=0; i<patchInfoString.length; i++) {
      if (patchInfoString[i] === previousPatchInfoString[i])
        last++;
      else {
        htmlPatchInfoString += patchInfoString.slice(first, last) + `<b>${patchInfoString[i]}</b>`;
        last++;
        first = last;
      }
    }
    if (first !== last)
      htmlPatchInfoString += patchInfoString.slice(first, last);
  }
  else
    htmlPatchInfoString = patchInfoString;

  previousPatchInfoString = patchInfoString;

  bodyCell.innerHTML = htmlPatchInfoString;
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

