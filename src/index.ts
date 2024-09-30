import { MIDIProxyForWebMIDIAPI } from "./MIDIProxyForWebMIDIAPI.js";
import { DeviceID, IMIDIProxy, MessageType } from "./midiproxy.js";
import { MIDIDeviceDescription, getMIDIDeviceList, isMIDIIdentityResponse, isSysex } from "./miditools.js";
import { getExceptionErrorString, partialArrayMatch, bytesToHexString, hexStringToUint8Array, getNumberFromBits, crc32, partialArrayStringMatch, eight2seven, seven2eight, bytesWithCharactersToString, compareBuffers, setBitsFromNumber } from "./tools.js";
import { decodeWFCFromString, encodeWFCToString, WFCFormatType } from "./wfc.js";
import { EffectSettings, ZoomPatch } from "./ZoomPatch.js";
import { EffectParameterMap, ZoomDevice } from "./ZoomDevice.js";
import { ConfirmDialog, getChildWithIDThatStartsWith, getColorFromEffectID, loadDataFromFile, saveBlobToFile, supportsContentEditablePlaintextOnly, getPatchNumber, togglePatchesTablePatch, getCellForMemorySlot, InfoDialog } from "./htmltools.js";
import { ZoomScreen, ZoomScreenCollection } from "./ZoomScreenInfo.js";
import { ZoomPatchEditor } from "./ZoomPatchEditor.js";

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

function updateZoomDevicesTable(zoomDevices: ZoomDevice[]) {
  let midiDevicesTable: HTMLTableElement = document.getElementById("midiDevicesTable") as HTMLTableElement;

  for (let index = 0; index < zoomDevices.length; index++) {
    let info = zoomDevices[index].deviceInfo;
    let version = ZoomDevice.getZoomVersionNumber(info.versionNumber);

    let row = midiDevicesTable.insertRow(1);
    let c;
    c = row.insertCell(-1); c.innerHTML = info.deviceName;
    c = row.insertCell(-1); c.innerHTML = bytesToHexString([info.familyCode[0]]);
    c = row.insertCell(-1); c.innerHTML = version.toString();
    c = row.insertCell(-1); c.innerHTML = info.inputName;
    c = row.insertCell(-1); c.innerHTML = info.outputName;
    c = row.insertCell(-1); c.innerHTML = bytesToHexString(info.identityResponse, " ");

    console.log(`  ${index + 1}: ${info.deviceName.padEnd(8)} OS v ${version} - input: ${info.inputName.padEnd(20)} output: ${info.outputName}`);
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
let zoomCommandTempBuffer = new Uint8Array(hexStringToUint8Array("F0 52 00 B3 B4 F7")); 

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

function getZoomCommand(zoomDeviceID: number, command: string): Uint8Array
{
  return hexStringToUint8Array(`F0 52 00 ${zoomDeviceID.toString(16).padStart(2, "0")} ${command} F7`);
}


function sendZoomCommandLong(device: DeviceID, deviceId: number, data: Uint8Array) : void
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

  let sendData = new Uint8Array(4 + data.length + 1);
  sendData.set(hexStringToUint8Array(`F0 52 00`));
  sendData[3] = deviceId & 0b01111111;
  sendData.set(data, 4);
  sendData[sendData.length - 1] = 0xF7;

  try 
  {
    midi.send(device, sendData);
  }
  catch (err) 
  {
    let message = getExceptionErrorString(err, `for device ${output.name}`);
    console.error(message);
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

  let zoomMidiDevices = midiDeviceList.filter( (device) => device.manufacturerID[0] === 0x52);

  zoomDevices = zoomMidiDevices.map( midiDevice => new ZoomDevice(midi, midiDevice));

  updateZoomDevicesTable(zoomDevices);
  
  
  for (const device of zoomDevices)
  {
    await device.open();
    device.parameterEditEnable();
    device.addListener(handleMIDIDataFromZoom);
    device.addMemorySlotChangedListener(handleMemorySlotChangedEvent);
    device.autoUpdateScreens = true;
    device.addScreenChangedListener(handleScreenChangedEvent)
    device.autoRequestCurrentPatch = true;
    device.addCurrentPatchChangedListener(handleCurrentPatchChanged);
    device.addPatchChangedListener(handlePatchChanged);
    device.autoRequestProgramChange = true;
    device.addTempoChangedListener(handleTempoChanged);
  };  

  let zoomDevice = zoomDevices[0];

  await downloadEffectMaps();

  patchEditor.setTextEditedCallback( (event: Event, type: string, initialValueString: string): boolean => {
    return handlePatchEdited(zoomDevice, event, type, initialValueString);
  });

  patchEditor.setMouseMovedCallback( (cell: HTMLTableCellElement, initialValueString: string, x: number, y: number) => {
    handleMouseMoved(zoomDevice, cell, initialValueString, x, y);
  });
  
  patchEditor.setMouseUpCallback( (cell: HTMLTableCellElement, initialValueString: string, x: number, y: number) => {
    handleMouseUp(zoomDevice, cell, initialValueString, x, y);
  });

  // console.log("Call and response start");
  // let callAndResponse = new Map<string, string>();
  // let commandIndex = 0x51;
  // let device = zoomDevices[0];
  // midi.addListener(device.deviceInfo.inputID, (deviceHandle, data) => {
  //   let call = bytesToHexString([commandIndex]);
  //   let response = bytesToHexString(data, " ");
  //   callAndResponse.set(call, response);
  //   console.log(`${call} -> ${response}`)
  // });
  // let testButton: HTMLButtonElement = document.getElementById("testButton") as HTMLButtonElement;
  // testButton.addEventListener("click", (event) => {
  //   commandIndex++;
  //   sendZoomCommand(device.deviceInfo.outputID, device.deviceInfo.familyCode[0], commandIndex);
  // });
  // console.log("Call and response end");

}

async function downloadEffectMaps() {
  let startTime = performance.now();
  let timeSpent = performance.now() - startTime;

  let obj = await downloadJSONResource("zoom-effect-mappings-ms50gp.json");

  console.log(`Downloading took  ${((performance.now() - startTime) / 1000).toFixed(3)} seconds ***`);
  startTime = performance.now();

  let mapForMS50GPlus: Map<number, EffectParameterMap> = new Map<number, EffectParameterMap>(Object.entries(obj).map(([key, value]) => [parseInt(key, 16), value as EffectParameterMap]));

  console.log(`mapForMS50GPlus.size = ${mapForMS50GPlus.size}`);

  obj = await downloadJSONResource("zoom-effect-mappings-ms70cdrp.json");

  console.log(`Downloading took  ${((performance.now() - startTime) / 1000).toFixed(3)} seconds ***`);
  startTime = performance.now();

  let mapForMS70CDRPlus: Map<number, EffectParameterMap> = new Map<number, EffectParameterMap>(Object.entries(obj).map(([key, value]) => [parseInt(key, 16), value as EffectParameterMap]));

  console.log(`mapForMS70CDRPlus.size = ${mapForMS70CDRPlus.size}`);

  obj = await downloadJSONResource("zoom-effect-mappings-msog.json");

  console.log(`Downloading took  ${((performance.now() - startTime) / 1000).toFixed(3)} seconds ***`);
  startTime = performance.now();

  let mapForMSOG: Map<number, EffectParameterMap> = new Map<number, EffectParameterMap>(Object.entries(obj).map(([key, value]) => [parseInt(key, 16), value as EffectParameterMap]));

  console.log(`mapForMSOG.size = ${mapForMSOG.size}`);

  ZoomDevice.setEffectIDMapForMSOG(mapForMSOG);

  // merge maps
  let parameterMap: Map<number, EffectParameterMap>;
  parameterMap = mapForMS50GPlus;
  mapForMS70CDRPlus.forEach((value, key) => {
    parameterMap.set(key, value);
  });

  ZoomDevice.setEffectIDMap(parameterMap);
  //ZoomDevice.setEffectIDMap(mapForMS70CDRPlus);

  // mapForMSOG.forEach( (value, key) => {
  //   if (parameterMap.has(key) === true) {
  //     console.warn(`Warning: Overriding effect ${parameterMap.get(key)!.name} for with MSOG effect "${value.name}" 0x${key.toString(16).padStart(8, "0")}`);
  //   }
  //   parameterMap.set(key, value);
  // })
  console.log(`parameterMap.size = ${parameterMap.size}`);
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

let mappings: { [key: string]: EffectParameterMap; } | undefined;

let mapEffectsButton: HTMLButtonElement = document.getElementById("mapEffectsButton") as HTMLButtonElement;
let origonalMapEffectsLabel = mapEffectsButton.innerText;
mapEffectsButton.addEventListener("click", async (event) => {

  let zoomDevice = zoomDevices[0];

  let text = `
    <p>You're about to start mapping all parameters for all effects on your pedal</p>

    <p>This is only relevant for the MS+ series of pedals, so if you have any other pedals, this mapping probably won't work. 
    Also, mapping has already been done for the MS-50G+ and MS-70CDR+ pedals, so there's no need to map these again.</p>

    <p>The mapping process will generate a mapping file that is needed for the patch editor to work for your pedal.
    This mapping file will be added to future releases of ZoomExplorer.</p>

    <p>To prevent any patch changes being saved to the pedal during mapping, auto-save will be disabled before the mapping starts.
    If you want to enable it again, you need to do so in the menu on the pedal after mapping has completed.</p>

    <p>The mapping process could take several hours. Please leave the pedal untouched while the mapping is ongoing.</p>

    <p>When the mapping is done, please click the "Save mappings" button to save the mapping to a file, and email this file to h@mmer.no. 
    Please also include the name of your pedal.</p>

    <p>Do you want to continue?</p>
  `;


  if (mapEffectsButton.innerText == "Cancel") {
    zoomDevice.cancelMapping();
    mapEffectsButton.innerText = "...";
    return;
  }

  if (mappings === undefined) {
    let result = await confirmDialog.getUserConfirmation(text);

    if (!result)
      return;

    if (zoomDevice.currentPatch === undefined || zoomDevice.currentPatch.effectSettings === null || 
      zoomDevice.currentPatch.effectSettings[0].id === 0)
    {
      // Select a non-empty patch
      if (zoomDevice.patchList.length <1)
        await updatePatchList();

      let memorySlot = 0;
      while (memorySlot < zoomDevice.patchList.length) {
        let patch = zoomDevice.patchList[memorySlot];
        if (patch.effectSettings !== null && patch.effectSettings[0].id !== 0)
          break;
        memorySlot++;
      }
      zoomDevice.setCurrentMemorySlot(memorySlot)
    }

    zoomDevice.setAutoSave(false);   
    zoomDevice.setCurrentEffectSlot(0); // set current effect slot to 0, to give the user a chance to monitor the mapping 

    await sleepForAWhile(600);

    mapEffectsButton.innerText = "Cancel";
    mappings = await zoomDevice.mapParameters();
    mapEffectsButton.innerText = "Save mappings";

    infoDialog.show(`Mapping completed. Please click the "Save mappings" button and email the file to h@mmer.no together with the name of your pedal.`);
  }
  else {
    let json = JSON.stringify(mappings, null, 2);
    const blob = new Blob([json]);
    let filename = zoomDevice.deviceInfo.deviceName + "-mappings.txt";
    await saveBlobToFile(blob, filename, ".txt", "Mappings json");
    mapEffectsButton.innerText = origonalMapEffectsLabel;
    mappings = undefined;
  }


  // let listFilesCommand = hexStringToUint8Array("60 25 00 00 2A 2E 2A 00");
  // let getNextFileCommand = hexStringToUint8Array("60 26 00 00 2A 2E 2A 00");

  // let device = zoomDevices[0];

  // await sleepForAWhile(50);
  // sendZoomCommandLong(device.deviceInfo.outputID, device.deviceInfo.familyCode[0], listFilesCommand);

  // for (let i=0; i<600; i++) {
  //   await sleepForAWhile(50);
  //   sendZoomCommandLong(device.deviceInfo.outputID, device.deviceInfo.familyCode[0], getNextFileCommand);
  // }

  // await sleepForAWhile(50);
  // let endFileListingCommand = hexStringToUint8Array("60 27");
  // sendZoomCommandLong(device.deviceInfo.outputID, device.deviceInfo.familyCode[0], endFileListingCommand);
});

type MidiMuteFunction = (data: Uint8Array) => boolean;

function updateMidiMonitorTable(device: MIDIDeviceDescription, data: Uint8Array, messageType: MessageType, mute: MidiMuteFunction | undefined = undefined) {
  messageCounter++;
  if (mute !== undefined && mute(data))
    return; 
  let command = data[0] >> 4;
  let color = ["#005500", "#00BB00", "#000000", "#550000", "#000000", "#000000", "#000000", "#000000",];
  let table: HTMLTableElement = document.getElementById("midiMonitorTable") as HTMLTableElement;
  let row = table.insertRow(1);
  let c;
  c = row.insertCell(-1); c.innerHTML = messageCounter.toString();
  c = row.insertCell(-1); c.innerHTML = device.deviceName;
  c = row.insertCell(-1); c.innerHTML = bytesToHexString([data[0]]); c.style.color = color[command - 8];
  c = row.insertCell(-1); c.innerHTML = bytesToHexString([data[1]]);
  c = row.insertCell(-1); c.innerHTML = bytesToHexString([data[2]]); c.id = "value"; c.style.backgroundSize = (data[2] / 127 * 100) + "%";
  c = row.insertCell(-1); c.innerHTML = MessageType[messageType];
  c = row.insertCell(-1); c.innerHTML = data.length.toString();

  let documentHeight = Math.max(document.body.scrollHeight, document.body.offsetHeight,
    document.documentElement.clientHeight, document.documentElement.scrollHeight, document.documentElement.offsetHeight);

  // Remove old messages if table gets taller than window. 
  while ((table.rows.length > 5) &&  ((table.offsetTop + table.clientHeight + 20 > window.innerHeight) || (table.rows.length > 100))) {
    table.deleteRow(table.rows.length - 1);
  }
}
      
function updateSysexMonitorTable(device: MIDIDeviceDescription, data: Uint8Array)
{ 
  let table: HTMLTableElement = document.getElementById("sysexMonitorTable") as HTMLTableElement;  
  
  let sysexLength = data.length;
  let dataset = sysexMap.get(sysexLength);

  if (dataset === undefined) 
  {
    dataset = { previous: data, current: data, device: device, messageNumber: messageCounter };
    sysexMap.set(sysexLength, dataset);      
  }
  else
  {
    sysexMap.set(sysexLength, { previous: dataset.current, current: data, device: device, messageNumber: messageCounter });      
  } 

  const sentenceLength = 10;
  const lineLength = 50;
  const paragraphHeight = 4;

  let row: HTMLTableRowElement;
  // while (table.rows.length > 0) {
  //   table.deleteRow(0);
  // }

  let cellCounter = 0;

  dataset = sysexMap.get(sysexLength);
  if (dataset === undefined)
    return;

  let headerCell: HTMLTableCellElement;
  let bodyCell: HTMLTableCellElement;

  let dataType1 = bytesToHexString([dataset.current[4]]);
  let dataType2 = bytesToHexString([dataset.current[5]]);
  let dataTypeString = getZoomCommandName(dataset.current);
  
  let updatedRow = false;
  let rowId = `Sysex_Row_Header_${sysexLength}`;
  row = document.getElementById(rowId) as HTMLTableRowElement;
  if (row === null) {
    let dataLength = data.length; // for the click handler lambdas 
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

      let dataset = sysexMap.get(dataLength);
      let sysexString = `ERROR: sysexMap.get(${dataLength}) returned undefined`;
      if (dataset !== undefined)
        sysexString = generateHTMLSysexString(dataset.current, dataset.previous, paragraphHeight, lineLength, sentenceLength, useASCII, useEightBit, eightBitOffset);
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

      let dataset = sysexMap.get(dataLength);
      let sysexString = `ERROR: sysexMap.get(${dataLength}) returned undefined`;
      if (dataset !== undefined)
        sysexString = generateHTMLSysexString(dataset.current, dataset.previous, paragraphHeight, lineLength, sentenceLength, useASCII, useEightBit, eightBitOffset);
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

      let dataset = sysexMap.get(dataLength);
      let sysexString = `ERROR: sysexMap.get(${dataLength}) returned undefined`;
      if (dataset !== undefined)
        sysexString = generateHTMLSysexString(dataset.current, dataset.previous, paragraphHeight, lineLength, sentenceLength, useASCII, useEightBit, eightBitOffset);
      bodyCell.innerHTML = sysexString;   
    });
    headerCell.appendChild(inputASCII);

    cellCounter++;

  } else {
    headerCell = row.cells[0];
  }

  let headerSpan = getChildWithIDThatStartsWith(headerCell.children, "sysexHeader") as HTMLSpanElement;
  headerSpan.innerHTML = `<b>Message #${dataset.messageNumber} from ${dataset.device.deviceName} [${bytesToHexString([dataset.device.familyCode[0]])}]` +
  ` type "${dataTypeString}" [${dataType1} ${dataType2}] length ${sysexLength}</b> &nbsp;&nbsp;`;

  let current = dataset.current;
  let previous = dataset.previous;    

  let inputASCII = getChildWithIDThatStartsWith(headerCell.children, "ASCIICheckbox") as HTMLInputElement;
  let inputEightBit = getChildWithIDThatStartsWith(headerCell.children, "eightBitCheckbox") as HTMLInputElement;
  let inputEightBitOffset = getChildWithIDThatStartsWith(headerCell.children, "eightBitOffset") as HTMLInputElement;
  let useASCII = inputASCII.checked;
  let useEightBit = inputEightBit.checked;
  let eightBitOffset = inputEightBitOffset.value != null ? parseFloat(inputEightBitOffset.value) : 0;

  if (current.length === 985 || current.length === 989) {
    let offset = 9 + current.length - 985;
    let eightBitCurrent = seven2eight(current, offset, current.length-2);
  }

  let sysexString = generateHTMLSysexString(current, previous, paragraphHeight, lineLength, sentenceLength, useASCII, useEightBit, eightBitOffset);

  rowId = `Sysex_Row_Body_${sysexLength}`;
  row = document.getElementById(rowId) as HTMLTableRowElement;
  if (row === null) {
    row = table.insertRow(-1);
    row.id = rowId;
    bodyCell = row.insertCell(-1);
  } else {
    bodyCell = row.cells[0];
  }

  bodyCell.innerHTML = sysexString; 
  bodyCell.contentEditable = supportsContentEditablePlaintextOnly() ? "plaintext-only" : "true";
}

function html2Uint8Array(html: string) {
  let sysexString = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\r|\n/g, " "); // remove html tags, &nbsp;, and newlines
  let sysexData = Uint8Array.from(sysexString.split(" ").filter(value => value.length === 2).map(value => parseInt(value, 16)));
  return sysexData;
}

function generateHTMLSysexString(current: Uint8Array, previous: Uint8Array, paragraphHeight: number, lineLength: number, sentenceLength: number, 
                                 ascii: boolean = false, eightBit: boolean = false, eightBitOffset: number = 0) 
{
  let mixed = true;
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
  let hexString = "";
  for (let i = 0; i < current.length; i++) {
    if (ascii) {
      let printableASCIIValue = current[i] >= 32 && current[i] <= 126 ? current[i] : current[i] == 0 ? 95 : 39; // printable, _ or '    
      if (mixed)
        hexString = current[i] >= 32 && current[i] <= 126 ? `&nbsp;&#${printableASCIIValue};` : current[i] === 0 ? "&nbsp;_" : bytesToHexString([current[i]]);  
      else
        hexString = `&#${printableASCIIValue};`;
    }
    else
      hexString = bytesToHexString([current[i]]);
    
    // let printableASCIIValue: number = current[i] >= 32 && current[i] <= 126 ? current[i] : current[i] == 0 ? 95 : 39; // printable, _ or '
    // hexString = ascii ? `&#${printableASCIIValue};` : bytesToHexString([current[i]]);

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
    else if (!(ascii && !mixed))
      sysexString += "&nbsp;";
  }
  return sysexString;
}

// let previousEditScreenCollection: ZoomScreenCollection | undefined = undefined;
// let previousEditPatch: ZoomPatch | undefined = new ZoomPatch();
// previousEditScreenCollection = screenCollection;
// previousEditPatch = patch;

function handleMemorySlotChangedEvent(zoomDevice: ZoomDevice, memorySlot: number): void
{
  console.log(`Memory slot changed: ${memorySlot}`);

  let selected = getCellForMemorySlot(zoomDevice, "patchesTable", memorySlot);

  if (selected !==undefined && zoomDevice.patchList.length > 0) {
    togglePatchesTablePatch(selected);
    if (lastSelected != null)
      togglePatchesTablePatch(lastSelected);    
    lastSelected = selected;
    currentZoomPatch = zoomDevice.patchList[memorySlot].clone();
    updatePatchInfoTable(currentZoomPatch);
    getScreenCollectionAndUpdateEditPatchTable(zoomDevice); // Added for MSOG 2024-07-13
  }
}

async function handleScreenChangedEvent(zoomDevice: ZoomDevice)
{
  console.log(`Screen changed`);
  getScreenCollectionAndUpdateEditPatchTable(zoomDevice);
}

function getScreenCollectionAndUpdateEditPatchTable(zoomDevice: ZoomDevice)
{
  let screenCollection = zoomDevice.currentScreenCollection;
  if (screenCollection === undefined && currentZoomPatch !== undefined && zoomDevice.effectIDMap !== undefined) {
    // FIXME: Not the most robust of designs... Depends on mapping being loaded and existing for that pedal.
    screenCollection = ZoomScreenCollection.fromPatchAndMappings(currentZoomPatch, zoomDevice.effectIDMap);
  }

  let compare = previousEditScreenCollection;
  // Note: should probably take patch equality into consideration...
  if (screenCollection !== undefined &&  screenCollection.equals(previousEditScreenCollection))
    compare = lastChangedEditScreenCollection;
  else
    lastChangedEditScreenCollection = previousEditScreenCollection;
  patchEditor.update(zoomDevice, screenCollection, currentZoomPatch, zoomDevice.currentMemorySlotNumber, compare, previousEditPatch);
  previousEditScreenCollection = screenCollection;
  previousEditPatch = currentZoomPatch;
}


function handleCurrentPatchChanged(zoomDevice: ZoomDevice): void 
{
  // Handle updates to name. 
  // Don't know if we really need this for anything else.
  console.log(`Current patch changed`);
  currentZoomPatch = zoomDevice.currentPatch !== undefined ? zoomDevice.currentPatch.clone() : undefined; // a bit unsure if it's correct to use currentZoomPatch for this.... See other uses in this file.
  previousEditPatch = currentZoomPatch;
  getScreenCollectionAndUpdateEditPatchTable(zoomDevice);
}

function handlePatchChanged(zoomDevice: ZoomDevice, memorySlot: number): void 
{
  console.log(`Patch changed for memory slot ${memorySlot}`);
  updatePatchesTable(zoomDevice);
}

function handleTempoChanged(zoomDevice: ZoomDevice, tempo: number): void {
  if (currentZoomPatch !== undefined && zoomDevice.currentPatch !== undefined) {
    updatePatchInfoTable(currentZoomPatch);
    setPatchParameter(zoomDevice, currentZoomPatch, "tempo", tempo, "tempo", false);
    getScreenCollectionAndUpdateEditPatchTable(zoomDevice);
  }
}



// FIXME: Look into if it's a good idea to have this function be async. 2024-06-26.
async function handleMIDIDataFromZoom(zoomDevice: ZoomDevice, data: Uint8Array): Promise<void>
{
  let [messageType, channel, data1, data2] = midi.getChannelMessage(data); 

  let device = zoomDevice.deviceInfo;
  updateMidiMonitorTable(device, data, messageType, (data: Uint8Array) => zoomDevice.logMutedTemporarilyForPollMessages(data)
  );

  if (messageType === MessageType.SysEx)
  {    
    updateSysexMonitorTable(device, data);

    // FIXME: Use ZoomDevice.sysexToPatchData() instead if the code below

    if (data.length > 10 && ((data[4] == 0x64 && data[5] == 0x12) || (data[4] == 0x45 && data[5] == 0x00) || (data[4] == 0x28)) ) {
      // We got a patch dump

      let offset;
      let messageLengthFromSysex;
      
      if ((data[4] == 0x28)) {
        messageLengthFromSysex = 0;
        offset = 5; 
      }
      else if (data[4] == 0x64 && data[5] == 0x12) {
        messageLengthFromSysex = data[7] + (data[8] << 7);
        offset = 9;
      }
      else { // (data[4] == 0x45 && data[5] == 0x00)
        messageLengthFromSysex = data[11] + (data[12] << 7);
        offset = 13;
      }

      let eightBitData = seven2eight(data, offset, data.length-2); // FIXME: We should ignore the last 5 bytes of CRC, use messageLengthFromSysex as limiter (extend seven2eight to support max 8 bit size)

      let patch = ZoomPatch.fromPatchData(eightBitData);
      // FIXME: Do we need this line below? This is handled in the handlePatchUpdate() function now...
      // currentZoomPatch = patch;

      if (eightBitData !== null && eightBitData.length > 5) {
        console.log(`messageLengthFromSysex = ${messageLengthFromSysex}, eightBitData.length = ${eightBitData.length}, patch.ptcfChunk.length = ${patch?.ptcfChunk?.length}`)
        let crc = crc32(eightBitData, 0, eightBitData.length - 1 - 5); // FIXME: note that 8 bit length is incorrect since it's 5 bytes too long, for the CRC we failed to ignore above
        crc = crc  ^ 0xFFFFFFFF;
        console.log(`Patch CRC (7-bit): ${bytesToHexString(new Uint8Array([crc & 0x7F, (crc >> 7) & 0x7F, (crc >> 14) & 0x7F, (crc >> 21) & 0x7F, (crc >> 28) & 0x0F]), " ")}`);
        
      }
      updatePatchInfoTable(patch);

      // patch.nameName = "Hei"; 

      let originalPatch = patch;
      patch = originalPatch.clone();        

      let originalPatchBuffer = patch.PTCF !== null ? patch.ptcfChunk : patch.msogDataBuffer;
      let patchBuffer = patch.PTCF !== null ? patch.buildPTCFChunk() : patch.buildMSDataBuffer();
      compareBuffers(patchBuffer, originalPatchBuffer);

      // let screenCollection = await zoomDevice.downloadScreens();
      // updateEditPatchTable(screenCollection, currentZoomPatch, previousEditScreenCollection, previousEditPatch);
      // previousEditScreenCollection = screenCollection;
      // previousEditPatch = currentZoomPatch;
    }
    else if (data.length === 15 && (data[4] === 0x64 && data[5] === 0x20)) {
      // Parameter was edited on device (MS Plus series)
      // Request patch immediately
      sendZoomCommandLong(device.outputID, device.familyCode[0], hexStringToUint8Array("64 13"));
      // Request screen info immediately
      // Not necessary as patch will also request it sendZoomCommandLong(device.outputID, device.familyCode[0], hexStringToUint8Array("64 02 00 02 00"));
    }
    else if (data.length === 10 && (data[4] === 0x31)) {
      // Parameter was edited on device (MS series)
      // Request patch immediately
      sendZoomCommand(device.outputID, device.familyCode[0], 0x29);
    }
    else if (data.length === 10 && data[4] === 0x06) {
      // Patch info
      let numPatches = data[5] + (data[6] << 7);
      let patchSize = data[7] + (data[8] << 7);
      console.log(`Received patch info message (0x06). Number of patches: ${numPatches}, patch size: ${patchSize}`)
    }
    else if (data.length === 30 && data[4] === 0x43) {
      // Bank/patch info
      let numPatches = data[5] + (data[6] << 7);
      let patchSize = data[7] + (data[8] << 7);
      let unknown = data[9] + (data[10] << 7);
      let bankSize = data[11] + (data[12] << 7);
      console.log(`Received patch info message (0x43). Number of patches: ${numPatches}, patch size: ${patchSize}, unknown: ${unknown}, bank size: ${bankSize}.`)
      console.log(`                                    Unknown: ${bytesToHexString(data.slice(13, 30-1), " ")}.`);
    }
    // else if (data.length > 10 && data[4] === 0x64 && data[5] === 0x01) {
    //   // Screen info
    //   let offset = 6;
    //   let screenCollection: ZoomScreenCollection = ZoomScreenCollection.fromScreenData(data, offset);

    //   updateEditPatchTable(screenCollection, currentZoomPatch);
    // }
  }
}

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

  let device = zoomDevices[0];

  device.setCurrentMemorySlot(patchNumber);

  let patch = device.patchList[patchNumber];
  updatePatchInfoTable(patch);

});

async function updatePatchList()
{
  let device = zoomDevices[0];
  
  await device.updatePatchListFromPedal();
  updatePatchesTable(device);

  let currentMemorySlot = await device.getCurrentMemorySlotNumber();
  if (currentMemorySlot !== undefined) {

    let device = zoomDevices[0];

    let selected = getCellForMemorySlot(device, "patchesTable", currentMemorySlot);

    if (selected !==undefined && device.patchList.length > 0) {
      togglePatchesTablePatch(selected);
      if (lastSelected != null)
        togglePatchesTablePatch(lastSelected);    
      lastSelected = selected;
      currentZoomPatch = device.patchList[currentMemorySlot].clone();
      updatePatchInfoTable(currentZoomPatch);
      getScreenCollectionAndUpdateEditPatchTable(device); // Added for MSOG 2024-07-13
    }
  } 
}


let downloadPatchesButton: HTMLButtonElement = document.getElementById("downloadPatchesButton") as HTMLButtonElement;
downloadPatchesButton.addEventListener("click", async (event) => {
  await updatePatchList();

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

//  let loadCurrentPatchButton: HTMLButtonElement = document.getElementById("loadCurrentPatchButton") as HTMLButtonElement;
//  loadCurrentPatchButton.addEventListener("click", async (event) => {
//    let device = zoomDevices[0];

//    device.requestCurrentPatch();
//  });


let previousPatchInfoString = ""; 

function updatePatchesTable(device: ZoomDevice) 
{
  let headerRow = patchesTable.rows[0];
  let numColumns = headerRow.cells.length / 2;

  let numPatchesPerRow = Math.ceil(device.patchList.length / numColumns);

  for (let i = patchesTable.rows.length - 1; i < numPatchesPerRow; i++) {
    let row = patchesTable.insertRow(-1);
    for (let c = 0; c < numColumns * 2; c++) {
      let cell = row.insertCell(-1);
      cell.id = `${c}`;
    }
  }

  let row: HTMLTableRowElement;
  let bodyCell: HTMLTableCellElement;
  for (let i = 0; i < device.patchList.length; i++) {
    let patch = device.patchList[i];
    row = patchesTable.rows[1 + i % numPatchesPerRow];
    bodyCell = row.cells[Math.floor(i / numPatchesPerRow) * 2];
    bodyCell.innerHTML = `${i + 1}`;
    bodyCell = row.cells[Math.floor(i / numPatchesPerRow) * 2 + 1];
    let name = patch.nameName != null ? patch.nameName : patch.name;
    bodyCell.innerHTML = `${name}`;
  }
}

function updatePatchInfoTable(patch: ZoomPatch) {
  let patchTable = document.getElementById("patchTable") as HTMLTableElement;

  let headerCell = patchTable.rows[0].cells[0];
  let bodyCell = patchTable.rows[1].cells[0];

  let patchNameString = "";
  patchNameString = patch.name.trim();

  let idString = "";
  if (patch.ids !== null) {
    for (let i = 0; i < patch.ids.length; i++)
      idString += `${patch.ids[i].toString(16).toUpperCase().padStart(8, "0")} `;
    if (idString.length > 1)
      idString = idString.slice(0, idString.length - 1);
  };

  let unknownString = "";
  if (patch.PTCF != null) {
    if (patch.ptcfUnknown !== null) {
      for (let i = 0; i < patch.ptcfUnknown.length; i++)
        unknownString += `${patch.ptcfUnknown[i].toString(16).toUpperCase().padStart(2, "0")} `;
      if (unknownString.length > 1)
        unknownString = unknownString.slice(0, unknownString.length - 1);
    };
  }

  let targetString = "";
  if (patch.target !== null) {
    targetString = patch.target.toString(2).padStart(32, "0");
    targetString = targetString.slice(0, 8) + " " + targetString.slice(8, 16) + " " + targetString.slice(16, 24) + " " + targetString.slice(24, 32);
  }

  headerCell.innerHTML = "";
  let headerSpan = document.createElement("span");
  headerSpan.id = "patchTableHeader";
  headerCell.appendChild(headerSpan);

  let shortName = patch.ptcfShortName ?? "";

  let label = document.createElement("label") as HTMLLabelElement;
  label.textContent = `Patch: "${patchNameString}". Short name: "${shortName}". Version: ${patch.version}. Target: ${targetString}. Unknown: ${unknownString}. Length: ${patch.length}`;
  headerCell.appendChild(label);

  let lineBreak = document.createElement("br");
  headerCell.appendChild(lineBreak);

  label = document.createElement("label") as HTMLLabelElement;
  label.textContent = `Effects: ${patch.numEffects}. IDs: ${idString}.`;
  headerCell.appendChild(label);

  let button = document.createElement("button") as HTMLButtonElement;
  button.textContent = "Load current patch from pedal";
  button.id = "loadCurrentPatchButton";
  button.className = "loadSaveButtons";
  button.addEventListener("click", (event) => {
      let device = zoomDevices[0];
      device.requestCurrentPatch();
  });
  headerCell.appendChild(button);

  let savePatch = patch;
  button = document.createElement("button") as HTMLButtonElement;
  button.textContent = "Save to current patch on pedal";
  button.id = "saveCurrentPatchButton";
  button.className = "loadSaveButtons";
  button.addEventListener("click", (event) => {
    if (savePatch.ptcfChunk !== null || savePatch.MSOG !== null) {
      let device = zoomDevices[0];
      device.uploadPatchToCurrentPatch(savePatch);
    }
  });
  headerCell.appendChild(button);

  button = document.createElement("button") as HTMLButtonElement;
  button.textContent = "Save to memory slot on pedal";
  button.id = "savePatchToMemorySlotButton";
  button.className = "loadSaveButtons";
  button.addEventListener("click", async (event) => {
      if (savePatch.ptcfChunk !== null || savePatch.MSOG !== null) {
        if (lastSelected === null) {
          console.error("Cannot upload patch to memory slot since no memory slot was selected");
          return;
        }
        let memorySlot = getPatchNumber(lastSelected) - 1;

        let device = zoomDevices[0];

        let nameForPatchInSlot = "";
        if (memorySlot < device.patchList.length) {
          nameForPatchInSlot = device.patchList[memorySlot].nameTrimmed ?? nameForPatchInSlot;
          nameForPatchInSlot = `"${nameForPatchInSlot}"`;
        }

        let result = true;
        if (nameForPatchInSlot !== `"Empty"`)
          result = await confirmDialog.getUserConfirmation(`Are you sure you want to overwrite patch number ${memorySlot + 1} ${nameForPatchInSlot} ?`);
        if (result) {
          await device.uploadPatchToMemorySlot(savePatch, memorySlot, true);
          updatePatchesTable(device);
        }
      }
  });
  headerCell.appendChild(button);
  button = document.createElement("button") as HTMLButtonElement;
  button.textContent = "Save file";
  button.id = "savePatchToDiskButton";
  button.className = "loadSaveButtons";
  button.addEventListener("click", async (event) => {
    let device = zoomDevices[0];
    let [fileEnding, shortFileEnding, fileDescription] = device.getSuggestedFileEndingForPatch();
    let suggestedName = savePatch.name.trim().replace(/[ ]{2,}/gi," ") + "." + fileEnding;
    if (savePatch.ptcfChunk !== null && savePatch.ptcfChunk.length > 0) {
      const blob = new Blob([savePatch.ptcfChunk]);
      await saveBlobToFile(blob, suggestedName, shortFileEnding, fileDescription);
    }
    else if (savePatch.msogDataBuffer !== null && savePatch.msogDataBuffer.length > 0) {
      let sysex = device.getSysexForCurrentPatch(patch);
      if (sysex === undefined) {
        console.warn(`getSysexForCurrentPatch() failed for patch "${savePatch.name}"`);
        return;
      }
      let sysexString = bytesToHexString(sysex).toLowerCase();
      const blob = new Blob([sysexString]);
      await saveBlobToFile(blob, suggestedName, fileEnding, fileDescription);
    }

  });
  headerCell.appendChild(button);

  button = document.createElement("button") as HTMLButtonElement;
  button.textContent = "Load file";
  button.id = "loadPatchFromDiskButton";
  button.className = "loadSaveButtons";
  button.addEventListener("click", async (event) => {
    let device = zoomDevices[0];
    let [fileEnding, shortFileEnding, fileDescription] = device.getSuggestedFileEndingForPatch();
    let data: Uint8Array | undefined;
    let filename: string | undefined;
    [data, filename] = await loadDataFromFile(shortFileEnding, fileDescription);
    if (data === undefined || filename === undefined)
      return;
    if (partialArrayStringMatch(data, "PTCF")) {
        let patch = ZoomPatch.fromPatchData(data);
        updatePatchInfoTable(patch);
        return;
    }
    let sysexString = bytesWithCharactersToString(data);
    let convertedData = hexStringToUint8Array(sysexString);
    if (!isSysex(convertedData)) {
      console.error(`Unknown file format in file ${filename}`);
    }
    else if (convertedData[1] != 0x52) {
      console.error(`Sysex file is not for a Zoom device, filename: ${filename}, device ID: ${bytesToHexString([convertedData[1]])}`);
    }
    else {
      if (convertedData.length < 5 || convertedData[3] != device.deviceInfo.familyCode[0]) {
        console.log(`Sysex file with filename ${filename} is for Zoom device ID ${bytesToHexString([convertedData[3]])}, ` +
          `but attached device has device ID: ${bytesToHexString([device.deviceInfo.familyCode[0]])}. Attempting to load patch anyway.`);
      }

      let [patchData, program, bank] = ZoomDevice.sysexToPatchData(convertedData);

      if (patchData !== undefined) {
        let patch = ZoomPatch.fromPatchData(patchData);
        updatePatchInfoTable(patch);
      }
    } 
  });

  headerCell.appendChild(button);

  let patchInfoString: string = "";

  // NAME
  if (patch.NAME !== null) {

    let nameString = `${patch.NAME} Length: ${patch.nameLength?.toString().padStart(3, " ")}  Name: "${patch.nameName}"`;
    patchInfoString += (patchInfoString.length === 0 ? "" : "<br/>") + nameString;
  }

  // TXE1
  if (patch.TXE1 !== null) {
    let txe1String = `${patch.TXE1} Length: ${patch.txe1Length?.toString().padStart(3, " ")}  Description: "${patch.txe1DescriptionEnglish}"`;
    patchInfoString += (patchInfoString.length === 0 ? "" : "<br/>") + txe1String;
  }

  // PRM2
  if (patch.PRM2 != null) {
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
        editEffectSlotString = `${patch.prm2EditEffectSlot}  bits: ${patch.prm2Unknown[9].toString(2).padStart(8, "0")} ${patch.prm2Unknown[10].toString(2).padStart(8, "0")} ${patch.prm2Unknown[11].toString(2).padStart(8, "0")} ${patch.prm2Unknown[12].toString(2).padStart(8, "0")} `;
      if (patch.prm2Unknown.length > 20)
        driveString = `${patch.prm2Unknown[20].toString(2).padStart(8, "0")}`;
      if (patch.prm2Unknown.length > 13 && patch.prm2Unknown[9] !== 0x80)
        console.warn(`Patch ${patch.name}. Unknown PRM2 bits for prm2Unknown[9]: ${patch.prm2Unknown[9].toString(2).padStart(8, "0")} -Investigate`); 
      if (patch.prm2Unknown.length > 13 && (patch.prm2Unknown[10] & 0b00011111) !== 0b00001100)
        console.warn(`Patch ${patch.name}. Unknown PRM2 bits for prm2Unknown[10]: ${patch.prm2Unknown[10].toString(2).padStart(8, "0")} -Investigate`); 
    };
    let prm2String = `${patch.PRM2} Length: ${patch.prm2Length?.toString().padStart(3, " ")}  Tempo: ${tempoString}  Edit effect slot: ${editEffectSlotString}  First slot with drive: ${driveString}<br/>` + 
      `                  Unknown: ${unknownString}`;
    patchInfoString += (patchInfoString.length === 0 ? "" : "<br/>") + prm2String;
  }

  // TXJ1
  if (patch.TXJ1 !== null) {
    unknownString = "";
    if (patch.txj1DescriptionJapanese !== null) {
      for (let i = 0; i < patch.txj1DescriptionJapanese.length; i++) {
        if ((i > 0) && (i % 32 == 0))
          unknownString += "<br/>                           ";
        unknownString += `${patch.txj1DescriptionJapanese[i].toString(16).toUpperCase().padStart(2, "0")} `;
      }
    };
    let txj1String = `${patch.TXJ1} Length: ${patch.txj1Length?.toString().padStart(3, " ")}  Unknown: ${unknownString}`;
    patchInfoString += (patchInfoString.length === 0 ? "" : "<br/>") + txj1String;
  }

  // EDTB
  if (patch.EDTB !== null || patch.MSOG !== null) {
    let reversedBytes = (patch.EDTB !== null) ? patch.edtbReversedBytes : patch.msogEffectsReversedBytes;
    let effectSettingsArray = (patch.EDTB !== null) ? patch.edtbEffectSettings : patch.msogEffectSettings;
    let unknownOffset = (patch.EDTB !== null) ? -16 : 0; // See EDTB doc for bit layout and what is known
    let effectSettingsString = "";
    if (reversedBytes !== null && patch.ids !== null && effectSettingsArray !== null) {
      for (let i = 0; i < reversedBytes.length; i++) {
        let effectSettings = effectSettingsArray[i];
        let parameterString = ""; 
        for (let p=0; p<effectSettings.parameters.length; p++) {
          parameterString += effectSettings.parameters[p].toString().toUpperCase().padStart(4, " ") + " ";
        }
        effectSettingsString += `     Effect ID: ${patch.ids[i].toString(16).toUpperCase().padStart(8, "0")}  Settings: ${effectSettings.enabled ? "[ ON]" : "[OFF]"}  `;
        effectSettingsString += `ID: ${effectSettings.id.toString(16).toUpperCase().padStart(8, "0")}  Parameters: ${parameterString}<br/>`;
        effectSettingsString += `                          Reversed: `;
        let effect = reversedBytes[i];
        for (let p = 0; p < effect.length + unknownOffset; p++) {
            effectSettingsString += `${effect[p].toString(2).padStart(8, "0")} `;
          if (((p + 1) % 12 == 0) && (p + 1 < effect.length))
            effectSettingsString += "<br/>                                    ";
        }
        effectSettingsString += "<br/><br/>";
      }
      if (effectSettingsString.length > 1)
        effectSettingsString = effectSettingsString.slice(0, effectSettingsString.length - 5 * 2);
    };
    if (patch.EDTB !== null) {
      let edtbString = `${patch.EDTB} Length: ${patch.edtbLength?.toString().padStart(3, " ")}<br/>` + effectSettingsString;
      patchInfoString += (patchInfoString.length === 0 ? "" : "<br/>") + edtbString;
    }
    else {
      let msogString = `${patch.MSOG} Length: ${patch.length?.toString().padStart(3, " ")}<br/>` + effectSettingsString;
      patchInfoString += (patchInfoString.length === 0 ? "" : "<br/>") + msogString;
    }
  }

  if (patch.MSOG !== null) {
    let msogString = "";
    if (patch.msogTempo != null)
      msogString += `     Tempo: ${patch.msogTempo.toString().padStart(3, " ")}.`;
    if (patch.msogNumEffects != null)
      msogString += `  Number of effects: ${patch.msogNumEffects}.`;
    if (patch.msogEditEffectSlot != null)
      msogString += `  Edit effect slot: ${patch.msogEditEffectSlot.toString()}.`;
    if (patch.msogDSPFullBits != null)
      msogString += `  DSP Full: ${patch.msogDSPFullBits.toString(2).padStart(6, "0")}.`;
    let driveString = "";
    if (patch.msogUnknown1 !== null) {
      let msogUnknown1_0_str = "EEDDDDDD";
      let msogUnknown1_1_str = "TTTMMM" + patch.msogUnknown1[1].toString(2).padStart(8, "0").substring(6, 7) + "E";
      let msogUnknown1_2_str = patch.msogUnknown1[2].toString(2).padStart(8, "0").substring(0, 3) + "TTTTT";
      // let msogUnknown1_0_str = patch.msogUnknown1[0].toString(2).padStart(8, "0");
      // let msogUnknown1_1_str = patch.msogUnknown1[1].toString(2).padStart(8, "0");
      // let msogUnknown1_2_str = patch.msogUnknown1[2].toString(2).padStart(8, "0");
      msogString += `  Unknown1: ${msogUnknown1_0_str} ${msogUnknown1_1_str} ${msogUnknown1_2_str}.`;
    }
    if (patch.msogUnknown2 !== null)
      msogString += `  Unknown2: ${patch.msogUnknown2[0].toString(2).padStart(8, "0")}.`;
    patchInfoString += (patchInfoString.length === 0 ? "" : "<br/>") + msogString;
  }

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


function handlePatchEdited(zoomDevice: ZoomDevice, event: Event, type: string, initialValueString: string): boolean
{
  console.log(`Patch edited e is "${event}`);
  if (event.target === null)
    return false;
  if (currentZoomPatch === undefined) {
    console.error("Attempting to edit patch when currentZoomPatch is undefined")
    return false;
  }

  let cell = event.target as HTMLTableCellElement;
  let [effectSlot, parameterNumber] = patchEditor.getEffectAndParameterNumber(cell.id);
  console.log(`type = ${type}, cell.id = ${cell.id}, effectSlot = ${effectSlot}, parameterNumber = ${parameterNumber}`);

  if (cell.id === "editPatchTableNameID") {
    if (type === "focus") {
      console.log("focus");
      cell.innerText = currentZoomPatch.name !== null ? currentZoomPatch.name.replace(/ +$/, "") : ""; // use the full name, but remove spaces at the end
    }
    else if (type === "blur") {
      console.log(`blur - cell.innerText = ${cell.innerText}`);
      if (currentZoomPatch !== undefined) { 
        setPatchParameter(zoomDevice, currentZoomPatch, "name", cell.innerText, "name");
        cell.innerText = currentZoomPatch.nameTrimmed;
      }
    } else if (type === "input") {
      console.log(`Name changed to "${cell.innerText}"`);
      if (currentZoomPatch !== undefined) {
        currentZoomPatch.name = cell.innerText;
        currentZoomPatch.updatePatchPropertiesFromDerivedProperties();
        updatePatchInfoTable(currentZoomPatch);
      }
    }
  }
  else if (cell.id === "editPatchTableDescriptionID" && type === "blur") {
    setPatchParameter(zoomDevice, currentZoomPatch, "descriptionEnglish", cell.innerText, "description");
  }
  else if (cell.id === "editPatchTableTempoValueID" && type === "focus") {
    // cell.innerText = currentZoomPatch.tempo.toString().padStart(3, "0");
  }
  else if (cell.id === "editPatchTableTempoValueID" && type === "blur") {
    setPatchParameter(zoomDevice, currentZoomPatch, "tempo", cell.innerText, "tempo");
    // cell.innerText = currentZoomPatch.tempo.toString().padStart(3, "0") + " bpm";
  }
  else if (cell.id === "editPatchTableTempoValueID" && type === "key") {
    if (event instanceof KeyboardEvent && event.key === "ArrowUp") {
      cell.innerText = (Number.parseInt(cell.innerText) + 1).toString().padStart(3, "0");
      setPatchParameter(zoomDevice, currentZoomPatch, "tempo", cell.innerText, "tempo");
    }
    else if (event instanceof KeyboardEvent && event.key === "ArrowDown") {
      cell.innerText = (Number.parseInt(cell.innerText) - 1).toString().padStart(3, "0");
      setPatchParameter(zoomDevice, currentZoomPatch, "tempo", cell.innerText, "tempo");
    } 
  }
  else if (effectSlot !== undefined && parameterNumber !== undefined) {
    if (currentZoomPatch !== undefined && currentZoomPatch.effectSettings !== null && effectSlot < currentZoomPatch.effectSettings.length) {
      let effectID: number = -1;
      effectID = currentZoomPatch.effectSettings[effectSlot].id;
      let valueString = cell.innerText;
      let [rawValue, maxValue] = zoomDevice.getRawParameterValueFromString(effectID, parameterNumber, valueString);

      if (maxValue === -1 || rawValue < 0 || rawValue > maxValue) {
        return false; // mapped parameter not found, cancel edit
      }

      let updateParameter;
      if (type === "focus") {
        if (currentZoomPatch.currentEffectSlot !== effectSlot) {
          currentZoomPatch.currentEffectSlot = effectSlot;
          zoomDevice.setCurrentEffectSlot(effectSlot);
          // currentZoomPatch.updatePatchPropertiesFromDerivedProperties();
          // zoomDevice.uploadPatchToCurrentPatch(currentZoomPatch);      
          updatePatchInfoTable(currentZoomPatch);
        }
      }
      else if (type === "blur") {
        updateParameter = true;
      }
      else if (type === "key" && event instanceof KeyboardEvent) {
        updateParameter = false;
        if (event.key === "ArrowUp") {
          rawValue = Math.min(maxValue, rawValue + 1);
          updateParameter = true;
        }
        else if (event.key === "ArrowDown") {
          rawValue = Math.max(0, rawValue - 1);
          updateParameter = true;
        }
        else if (event.key === "PageUp") {
          rawValue = Math.min(maxValue, rawValue + 10);
          updateParameter = true;
        }
        else if (event.key === "PageDown") {
          rawValue = Math.max(0, rawValue - 10);
          updateParameter = true;
        }
        else if (event.key === "Tab") {
          let newParameterNumber = Math.min(currentZoomPatch.effectSettings[effectSlot].parameters.length - 1, 
            Math.max(0, parameterNumber + (event.shiftKey ? -1 : 1)));
          let cell = patchEditor.getCell(effectSlot, newParameterNumber);
          if (cell !== undefined) {
            cell.focus();
          }
        }
      }

      if (updateParameter) {
        if (currentZoomPatch.currentEffectSlot !== effectSlot) {
          currentZoomPatch.currentEffectSlot = effectSlot;
          zoomDevice.setCurrentEffectSlot(effectSlot);
          updatePatchInfoTable(currentZoomPatch);
        }
        cell.innerHTML = zoomDevice.getStringFromRawParameterValue(effectID, parameterNumber, rawValue);
        setPatchParameter(zoomDevice, currentZoomPatch, "effectSettings", [effectSlot, "parameters", parameterNumber, rawValue], "effectSettings");
      }
    } 
  }
  return true;
}

function handleMouseMoved(zoomDevice: ZoomDevice, cell: HTMLTableCellElement, initialValueString: string, x: number, y: number)
{
  if (currentZoomPatch === undefined) {
    console.error("Attempting to edit patch when currentZoomPatch is undefined")
    return;
  }

  let [effectSlot, parameterNumber] = patchEditor.getEffectAndParameterNumber(cell.id);
  console.log(`Mouse move (${x}, ${y}) for cell.id = ${cell.id}, effectSlot = ${effectSlot}, parameterNumber = ${parameterNumber}`);

  if (effectSlot !== undefined && parameterNumber !== undefined && currentZoomPatch !== undefined && 
    currentZoomPatch.effectSettings !== null && effectSlot < currentZoomPatch.effectSettings.length)
  {
    let effectID: number = -1;
    effectID = currentZoomPatch.effectSettings[effectSlot].id;
    let currentValueString = cell.innerText;
    let [currentRawValue, maxValue] = zoomDevice.getRawParameterValueFromString(effectID, parameterNumber, currentValueString);
    let initialRawValue;
    [initialRawValue, maxValue] = zoomDevice.getRawParameterValueFromString(effectID, parameterNumber, initialValueString);

    if (maxValue === -1 || initialRawValue < 0 || initialRawValue > maxValue) {
      return; // mapped parameter not found, cancel edit
    }

    let deadZone = 10;
    if (Math.abs(y) < deadZone)
      return; // mouse is too close to initial position, cancel edit
    y = (Math.abs(y) - deadZone) * Math.sign(y);
    let scale = maxValue <= 25 ? 0.12 : maxValue <= 50 ? 0.25 :maxValue <= 100 ? 0.5 : maxValue <= 150 ? 0.7 : 1;
    let distance = scale * y;
    let newRawValue = Math.round(Math.max(0, Math.min(maxValue, initialRawValue + distance)));

    if (newRawValue !== currentRawValue) {
      let newValueString = zoomDevice.getStringFromRawParameterValue(effectID, parameterNumber, newRawValue);
      cell.innerHTML = newValueString;
      patchEditor.updateValueBar(cell, newRawValue, maxValue);
      console.log(`Changing value for cell.id = ${cell.id} from ${currentValueString} (${currentRawValue}) to ${newValueString} (${newRawValue})`);
      setPatchParameter(zoomDevice, currentZoomPatch, "effectSettings", [effectSlot, "parameters", parameterNumber, newRawValue], "effectSettings");
    }
  } 
}

function handleMouseUp(zoomDevice: ZoomDevice, cell: HTMLTableCellElement, initialValueString: string, x: number, y: number) {
}


function setPatchParameter<T, K extends keyof ZoomPatch, L extends keyof EffectSettings>(zoomDevice: ZoomDevice, zoomPatch: ZoomPatch, key: K, value: T, keyFriendlyName: string = "", 
  syncToCurrentPatchOnPedalImmediately = true)
{
  if (keyFriendlyName.length === 0)
    keyFriendlyName = key.toString();

  // [effectSlot, "enabled", value]
  // [effectSlot, "id", value]
  // [effectSlot, "parameters", parameterNumber, value]
  if (key === "effectSettings" && value instanceof Array && value.length >= 3 && zoomPatch.effectSettings !== null) {
    let effectSlot = value[0];
    let effectSettingsKey = value[1];
    if (effectSettingsKey === "enabled") {
      zoomPatch.effectSettings[effectSlot].enabled = value[2] as boolean;
    } else if (effectSettingsKey === "id") {
      zoomPatch.effectSettings[effectSlot].id = value[2] as number;
    } else if (effectSettingsKey === "parameters") {
      let parameterNumber = value[2];
      let parameterIndex = parameterNumber - 2;
      let newValue = value[3] as number;
      if (newValue != zoomPatch.effectSettings[effectSlot].parameters[parameterIndex]) {
        zoomPatch.effectSettings[effectSlot].parameters[parameterIndex] = newValue;
  
        zoomPatch.updatePatchPropertiesFromDerivedProperties();
        if (syncToCurrentPatchOnPedalImmediately) {
          zoomDevice.setEffectParameterForCurrentPatch(effectSlot, parameterNumber, newValue);
          // zoomDevice.uploadPatchToCurrentPatch(zoomPatch);
        }
      }
    }
  } 
  else {
    // Set basic parameter
    (zoomPatch[key] as T) = value; 

    zoomPatch.updatePatchPropertiesFromDerivedProperties();
    if (syncToCurrentPatchOnPedalImmediately) 
      zoomDevice.uploadPatchToCurrentPatch(zoomPatch)
  }


  updatePatchInfoTable(zoomPatch);
}

async function downloadJSONResource(filename: string): Promise<any>
{
  let response = await fetch(`./${filename}`);
  if (!response.ok) {
    console.error(`Fetching file ${filename} failed with HTTP error ${response.status}`);
    return undefined;
  }
  return await response.json();
}

function testBitMangling(data:Uint8Array, startBit: number, endBit: number, value: number) {
  printBits(data);
  setBitsFromNumber(data, startBit, endBit, value);
  printBits(data);

  let value2 = getNumberFromBits(data, startBit, endBit);
  console.log(`value = ${value}, value2 = ${value2}`);
}

function printBits(data: Uint8Array) {
  let str = "";
  for (let i = 0; i < data.length; i++) {
    str += data[i].toString(2).padStart(8, "0") + " ";
  }
  console.log(`Bits: ${str}`);
}

let previousEditScreenCollection: ZoomScreenCollection | undefined = undefined;
let lastChangedEditScreenCollection: ZoomScreenCollection | undefined = undefined;
let previousEditPatch: ZoomPatch | undefined = new ZoomPatch();

let confirmDialog = new ConfirmDialog("confirmDialog", "confirmLabel", "confirmButton");
let infoDialog = new InfoDialog("infoDialog", "infoLabel", "infoOKButton");
let messageCounter: number = 0;
let midi: IMIDIProxy = new MIDIProxyForWebMIDIAPI();

// map from data length to previous and current data, used for comparing messages
let sysexMap = new Map<number, {previous: Uint8Array, current: Uint8Array, device: MIDIDeviceDescription, messageNumber: number}>(); 

let currentZoomPatch: ZoomPatch | undefined = undefined;

let zoomDevices: Array<ZoomDevice> = new Array<ZoomDevice>();

let patchEditor = new ZoomPatchEditor();

let value = 511;

let data = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 64, 1, 128, 0, 12, 130, 0, 0, 65]);
//let data: Uint8Array = new Uint8Array(20);
let bitpos = data.length * 8 - 1;
testBitMangling(data, bitpos, bitpos, 1);


start();
