import { MIDIProxyForWebMIDIAPI } from "./MIDIProxyForWebMIDIAPI.js";
import { DeviceID, IMIDIProxy, MessageType } from "./midiproxy.js";
import { MIDIDeviceDescription, getMIDIDeviceList, isMIDIIdentityResponse, isSysex } from "./miditools.js";
import { getExceptionErrorString, partialArrayMatch, bytesToHexString, hexStringToUint8Array, getNumberFromBits, crc32, partialArrayStringMatch, eight2seven, seven2eight, bytesWithCharactersToString } from "./tools.js";
import { decodeWFCFromString, encodeWFCToString, WFCFormatType } from "./wfc.js";
import { ZoomPatch } from "./ZoomPatch.js";
import { ZoomDevice } from "./ZoomDevice.js";
import { ConfirmDialog, getChildWithIdThatStartsWith, loadDataFromFile, saveBlobToFile, supportsPlaintextEdit } from "./htmltools.js";

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

async function sendZoomCommandAndGetReply(outputDevice: DeviceID,  zoomDeviceId: number, data: number[] | Uint8Array, inputDevice: DeviceID, verifyReply: (data: Uint8Array) => boolean, 
                         timeoutMilliseconds: number = 100) : Promise<Uint8Array | undefined>
{
  let output = midi.getOutputInfo(outputDevice);
  if (output === undefined)
  {
    console.warn(`WARNING: Not sending MIDI message to device ${outputDevice} as the device is unknown"`);
    return;
  }
  if (output.connection != "open")
  {
    console.warn(`WARNING: Not sending MIDI message to device ${output.name} as the port is in state "${output.connection}"`);
    return;
  }

  let sendData = new Uint8Array(4 + data.length + 1);
  sendData.set(hexStringToUint8Array(`F0 52 00`));
  sendData[3] = zoomDeviceId & 0b01111111;
  sendData.set(data, 4);
  sendData[sendData.length - 1] = 0xF7;

  try 
  {
    return await midi.sendAndGetReply(outputDevice, sendData, inputDevice, verifyReply, timeoutMilliseconds);
  }
  catch (err) 
  {
    let message = getExceptionErrorString(err, `for device ${output.name}`);
    console.error(message);
    return undefined;
  }
}

function zoomCommandMatch(data: Uint8Array, zoomDeviceID: number, command: Uint8Array): boolean
{
  return data.length >= 4 + command.length && data[0] == 0xF0 && data[data.length-1] == 0xF7 && data[1] == 0x52 && data[2] == 0 && data[3] == zoomDeviceID && 
    data.slice(4, 4 + command.length).every( (element, index) => element === command[index] );
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

async function getCurrentPatch(zoomDevice: ZoomDevice)
{
  let map = new Map<string, Array<Uint8Array>>();
  let device = zoomDevice.deviceInfo;

  let data = await midi.sendAndGetReply(device.outputID, new Uint8Array([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]), device.inputID, isMIDIIdentityResponse, 100);
  console.log(`Received data: ${data?.length}`);
  if (data == undefined)
    return;
  let chunks = new Array<Uint8Array>();
  chunks.push(data);
  map.set("SIRX", chunks);

  let requestPatch = getZoomCommand(device.familyCode[0], "64 13");
  chunks = new Array<Uint8Array>();
  chunks.push(requestPatch);
  map.set("SPTX", chunks);

  // data = await midi.sendAndGetReply(device.outputID, requestPatch, device.inputID,
  //   (received) => partialArrayMatch(received, toUint8Array("F0 52 00 6E 64 12")), 1000);
  data = await sendZoomCommandAndGetReply(device.outputID, device.familyCode[0], hexStringToUint8Array("64 13"), device.inputID,
    (received) => zoomCommandMatch(received, device.familyCode[0], hexStringToUint8Array("64 12")), 1000);

  console.log(`Received data: ${data?.length}`);
  if (data == undefined)
    return;
  chunks = new Array<Uint8Array>();
  chunks.push(data);
  map.set("SPRX", chunks);

  let wfp = await encodeWFCToString(map, WFCFormatType.ASCIICompressed);
  console.log(`WFP: "${wfp}"`);
  let map2 = await decodeWFCFromString(wfp);
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

  let zoomMidiDevices = midiDeviceList.filter( (device) => device.manufacturerID[0] === 0x52);

  let zoomDevices = zoomMidiDevices.map( midiDevice => new ZoomDevice(midi, midiDevice));

  updateZoomDevicesTable(zoomDevices);
  
  for (const device of zoomDevices)
    await device.open();

  for (const device of zoomDevices)
    device.parameterEditEnable();
  
  for (const device of zoomDevices)
  {
    device.addListener(handleMIDIDataFromZoom);

    // midi.addListener(device.inputID, (deviceHandle, data) => {
    //   console.log(`Received: ${toHexString(data, " ")}`);
    //   handleMIDIDataFromZoom(device, data);
    // });
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

  function updateMidiMonitorTable(device: MIDIDeviceDescription, data: Uint8Array, messageType: MessageType) {
    let command = data[0] >> 4;
    let color = ["#005500", "#00BB00", "#000000", "#550000", "#000000", "#000000", "#000000", "#000000",];
    let table: HTMLTableElement = document.getElementById("midiMonitorTable") as HTMLTableElement;
    let row = table.insertRow(1);
    let c;
    messageCounter++;
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
    // if ((table.getBoundingClientRect().top + table.clientHeight > window.innerHeight) || (table.rows.length > 100)) {
    //   table.deleteRow(table.rows.length - 1);
    // }
  
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
    
    // for (let [length, dataset] of sysexMap) 
    // {
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
  
      let headerSpan = getChildWithIdThatStartsWith(headerCell.children, "sysexHeader") as HTMLSpanElement;
      headerSpan.innerHTML = `<b>Message #${dataset.messageNumber} from ${dataset.device.deviceName} [${bytesToHexString([dataset.device.familyCode[0]])}]` +
      ` type "${dataTypeString}" [${dataType1} ${dataType2}] length ${sysexLength}</b> &nbsp;&nbsp;`;
  
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
        // let patch = ZoomPatch.fromPatchData(eightBitCurrent);
        // console.log(`Patch name: ${patch.name}`);
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
      bodyCell.contentEditable = supportsContentEditablePlaintextOnly ? "plaintext-only" : "true";
  
    // }
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
      let hexString = ascii ? `&#${printableASCIIValue};` : bytesToHexString([current[i]]);
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
  
  function handleMIDIDataFromZoom(zoomDevice: ZoomDevice, data: Uint8Array): void
  {
    let [messageType, channel, data1, data2] = midi.getChannelMessage(data); 
  
    let device = zoomDevice.deviceInfo;
    updateMidiMonitorTable(device, data, messageType);
  
    if (messageType === MessageType.SysEx)
    {
      // let sysexDataCell: HTMLTableRowElement = document.getElementById("sysexDataCell") as HTMLTableRowElement;
      // let hexString = toHexString2(data, " ");
      // sysexDataCell.innerHTML = hexString;
    
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
  
        if (eightBitData !== null && eightBitData.length > 5) {
          console.log(`messageLengthFromSysex = ${messageLengthFromSysex}, eightBitData.length = ${eightBitData.length}, patch.ptcfChunk.length = ${patch?.ptcfChunk?.length}`)
          let crc = crc32(eightBitData, 0, eightBitData.length - 1 - 5); // FIXME: note that 8 bit length is incorrect since it's 5 bytes too long, for the CRC we failed to ignore above
          crc = crc  ^ 0xFFFFFFFF;
          console.log(`Patch CRC (7-bit): ${bytesToHexString(new Uint8Array([crc & 0x7F, (crc >> 7) & 0x7F, (crc >> 14) & 0x7F, (crc >> 21) & 0x7F, (crc >> 28) & 0x0F]), " ")}`);
          
        }
        updatePatchInfoTable(patch);
      }
      else if (data.length === 15 && (data[4] === 0x64 && data[5] === 0x20)) {
        // Parameter was edited on device (MS Plus series)
        // Request patch immediately
        sendZoomCommandLong(device.outputID, device.familyCode[0], hexStringToUint8Array("64 13"));
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
    }
  }

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

  // let zoomPatches : Array<ZoomPatch>;

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

    let device = zoomDevices[0];

    let patch = device.patchList[patchNumber];

    updatePatchInfoTable(patch);

  });

  let downloadPatchesButton: HTMLButtonElement = document.getElementById("downloadPatchesButton") as HTMLButtonElement;
  downloadPatchesButton.addEventListener("click", async (event) => {

  //await getCurrentPatch(zoomDevices[0]);


    let device = zoomDevices[0];
  
    // If the user has recently (in the last few seconds) changed a parameter on the pedal,
    // the pedal will send out a patch dump automatically. This automatically sent message would 
    // confuse the patch request process below. I think it is the pedal itself that gets confused and sends out
    // multiple patch dumps. For the MS-50G+, the automatically sent patch message is 989 bytes long,
    // while the length of the patch message when we request a patch is 985 bytes long, so it is possible to filter,
    // but it would be better if we could do this in a more generic way.

    // for (const device of zoomDevices)
    // {
    //   sendZoomCommand(device.outputID, device.familyCode[0], 0x51);
    //   await sleepForAWhile(100);
    //   sendZoomCommand(device.outputID, device.familyCode[0], 0x50);
    //   await sleepForAWhile(100);
    // }
    
    // let maxNumPatches = 500;
    // zoomPatches = new Array<ZoomPatch>(maxNumPatches);
    // for (let i=0; i<maxNumPatches; i++) {

      // let bank = Math.floor(i/10);
      // let program = i % 10;
      // // let requestPatch = toUint8Array(`F0 52 00 6E 46 00 00 ${toHexString([bank])} 00 ${toHexString([program])} 00 F7`);
      // // let data = await midi.sendAndGetReply(device.outputID, requestPatch, device.inputID,
      // //   (received) => partialArrayMatch(received, toUint8Array("F0 52 00 6E 45 00")), 1000);
      // let requestPatch: Uint8Array;
      // let data: Uint8Array | undefined;

      // if (device.deviceInfo.familyCode[0] === 0x58) { // MS-50G
      //   // sendZoomCommand(device.outputID, device.familyCode[0], 0x29);
      //   requestPatch = toUint8Array(`09 00 00 ${toHexString([i])}`);
      //   data = await sendZoomCommandAndGetReply(device.deviceInfo.outputID, device.deviceInfo.familyCode[0], requestPatch, device.deviceInfo.inputID,
      //     (received) => zoomCommandMatch(received, device.deviceInfo.familyCode[0], toUint8Array("45 00")), 1000);  
      // }
      // else {
      //   requestPatch = toUint8Array(`46 00 00 ${toHexString([bank])} 00 ${toHexString([program])} 00`);
      //   data = await sendZoomCommandAndGetReply(device.deviceInfo.outputID, device.deviceInfo.familyCode[0], requestPatch, device.deviceInfo.inputID,
      //     (received) => zoomCommandMatch(received, device.deviceInfo.familyCode[0], toUint8Array("45 00")), 1000);
      // }
      // if (data === undefined) {
      //   console.log(`Got no reply for patch number ${i}`);
      //   zoomPatches.splice(i);
      //   break;
      // }
      // console.log(`Received data: ${data.length}`);

      // let offset = 9 + data.length - 985;
      // let eightBitData = seven2eight(data, offset, data.length-2);

      // let patch = ZoomPatch.fromPatchData(eightBitData);

    //   let patch = await device.downloadPatchFromMemorySlot(i)
    //   if (patch === undefined) {
    //     console.log(`Got no reply for patch number ${i}`);
    //     zoomPatches.splice(i);
    //     break;
    //   }
    //   zoomPatches[i] = patch;
    // }

    await device.updatePatchListFromPedal();
    updatePatchesTable();

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

  function updatePatchesTable() {
    let headerRow = patchesTable.rows[0];
    let numColumns = headerRow.cells.length / 2;

    let device = zoomDevices[0];
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
      let name = patch.longName != null ? patch.longName : patch.name;
      bodyCell.innerHTML = `${name}`;
    }
  }

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
  
    // headerCell.innerHTML = `Patch: "${patchNameString}". Version: ${patch.version}. Target: ${targetString}. Unknown: ${unknownString}. Length: ${patch.length}<br/>` +
    //   `Effects: ${patch.numEffects}. IDs: ${idString}.`;
  
    headerCell.innerHTML = "";
    let headerSpan = document.createElement("span");
    headerSpan.id = "patchTableHeader";
    headerCell.appendChild(headerSpan);
  
    let label = document.createElement("label") as HTMLLabelElement;
    label.textContent = `Patch: "${patchNameString}". Version: ${patch.version}. Target: ${targetString}. Unknown: ${unknownString}. Length: ${patch.length}`;
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
        // let eightBitData = savePatch.ptcfChunk;
        // let crc = crc32(eightBitData, 0, eightBitData.length - 1);
        // crc = crc  ^ 0xFFFFFFFF;
        // let crcBytes = new Uint8Array([crc & 0x7F, (crc >> 7) & 0x7F, (crc >> 14) & 0x7F, (crc >> 21) & 0x7F, (crc >> 28) & 0x0F]);
        // console.log(`Patch name: ${savePatch.name}`);
        // console.log(`Patch data length: ${eightBitData.length}`);
        // console.log(`Patch CRC (7-bit): ${toHexString(crcBytes, " ")}`);

        device.uploadCurrentPatch(savePatch);
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
          // let eightBitData = savePatch.ptcfChunk;
          // let crc = crc32(eightBitData, 0, eightBitData.length - 1);
          // crc = crc  ^ 0xFFFFFFFF;
          // let crcBytes = new Uint8Array([crc & 0x7F, (crc >> 7) & 0x7F, (crc >> 14) & 0x7F, (crc >> 21) & 0x7F, (crc >> 28) & 0x0F]);
          // console.log(`Patch name: ${savePatch.name}`);
          // console.log(`Memory slot number: ${memorySlot + 1} "${zoomPatches[memorySlot].nameTrimmed}"`);
          // console.log(`Patch data length: ${eightBitData.length}`);
          // console.log(`Patch CRC (7-bit): ${toHexString(crcBytes, " ")}`);

          let result = true;
          if (nameForPatchInSlot !== `"Empty"`)
            result = await confirmDialog.getUserConfirmation(`Are you sure you want to overwrite patch number ${memorySlot + 1} ${nameForPatchInSlot} ?`);
          if (result) {
            await device.uploadPatchToMemorySlot(savePatch, memorySlot, true);
            // let patch = await device.downloadPatchFromMemorySlot(memorySlot);
            // //let patch = savePatch;
            // if (patch !== undefined) {
            //   zoomPatches[memorySlot] = patch;
            //   updatePatchesTable();
            // }
            updatePatchesTable();
          }

          // confirmLabel.textContent = `Are you sure you want to overwrite patch number ${memorySlot + 1} "${zoomPatches[memorySlot].nameTrimmed}" ?`
          // confirmEvent = async (result: boolean) => {
          //   if (result) {
          //     device.uploadPatchToMemorySlot(savePatch, memorySlot);
          //     let patch = await device.downloadPatchFromMemorySlot(memorySlot);
          //     if (patch !== undefined) {
          //       zoomPatches[memorySlot] = patch;
          //       updatePatchesTable();
          //     }
          //   }
          // }
          // confirmDialog.showModal();
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
      let suggestedName = savePatch.name !== null ? savePatch.name.trim().replace(/[ ]{2,}/gi," ") + "." + fileEnding : `patch.${fileEnding}`;
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
      // try {
      //   if (window.showOpenFilePicker !== undefined) {
      //       const [fileHandle] = await window.showOpenFilePicker({
      //       types: [
      //         { description: fileDescription,
      //           accept: { "application/octet-stream" : [`.${fileEnding}`]}
      //         }
      //       ] 
      //     });
      //     const blob = await fileHandle.getFile();
      //     const buffer = await blob.arrayBuffer();
      //     const data = new Uint8Array(buffer);
      //     let patch = ZoomPatch.fromPatchData(data);
      //     updatePatchInfoTable(patch);
      //   } else {
      //     // Fallback to old-school file upload
      //     let input: HTMLInputElement = document.getElementById("fileInput") as HTMLInputElement;
      //     if (input === null) {
      //       input = document.createElement("input") as HTMLInputElement;
      //       input.id = "fileInput";
      //       input.type = "file";
      //       input.accept = `.${fileEnding}`;
      //       input.style.opacity = "0";
      //       let content = document.getElementById("content") as HTMLDivElement;
      //       content.appendChild(input);
      //     }

      //     // Clear old event listeners
      //     let clonedInput = input.cloneNode(true) as HTMLInputElement;
      //     input.parentNode?.replaceChild(clonedInput, input);
      //     input = clonedInput;
      //     input.files = null;
      //     input.value = "";

      //     input.addEventListener("change", () => {
      //       console.log(`Selected filename: ${input.value}`);
      //       const fileReader = new FileReader();
      //       fileReader.onload = (e) => {
      //         console.log("File loaded");
      //         if (fileReader.result != null) {
      //           let buffer = fileReader.result as ArrayBuffer;
      //           const data = new Uint8Array(buffer);
      //           let patch = ZoomPatch.fromPatchData(data);
      //           updatePatchInfoTable(patch);
      //         }
      //       };
      //       if (input.files != null)
      //         fileReader.readAsArrayBuffer(input.files[0])
      //     }, false);
      //     input.click();
      //   }
      // } catch (err) {
      //   console.log(err); 
      // }
    });

    headerCell.appendChild(button);

    let patchInfoString: string = "";

    // NAME
    if (patch.NAME !== null) {

      let nameString = `${patch.NAME} Length: ${patch.nameLength?.toString().padStart(3, " ")}  Name: "${patch.longName}"`;
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
          editEffectSlotString = `${patch.prm2Unknown[10].toString(2).padStart(8, "0")} ${patch.prm2Unknown[11].toString(2).padStart(8, "0")} ${patch.prm2Unknown[12].toString(2).padStart(8, "0")} `;
        if (patch.prm2Unknown.length > 20)
          driveString = `${patch.prm2Unknown[20].toString(2).padStart(8, "0")}`;
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
      let unknownOffset = (patch.EDTB !== null) ? -Math.ceil(90/8 + 5) + 3 : 0 
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
          // for (let p = 0; p < effect.length - Math.ceil(90/8 + 5) + 3; p++) {
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
        msogString += `  Unknown1: ${msogUnknown1_0_str} ${msogUnknown1_1_str} ${msogUnknown1_2_str}.`;
      }
      if (patch.msogUnknown2 !== null)
        msogString += `  Unknown2: ${patch.msogUnknown2[0].toString(2).padStart(8, "0")}.`;
      patchInfoString += (patchInfoString.length === 0 ? "" : "<br/>") + msogString;
    }

    // let patchInfoString = nameString + "<br/>" + txe1String + "<br/>" + prm2String + "<br/>" + txj1String + "<br/>" + edtbString; 
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

}

let supportsContentEditablePlaintextOnly = supportsPlaintextEdit();

// let seven=toUint8Array("01 02 03 04 05 06 07 08 09");
// console.log(`Seven: ${toHexString(seven, " ")}`);
// let eight = seven2eight(seven);
// console.log(`Eight: ${toHexString(eight, " ")}`);

// let eight = hexStringToUint8Array("81 02 83 04 85 06 07 08 09 8A");
// console.log(`Eight: ${bytesToHexString(eight, " ")}`);

// let seven = eight2seven(eight);
// console.log(`Seven: ${bytesToHexString(seven, " ")}`);

// let eight2 = seven2eight(seven);
// console.log(`Eight: ${bytesToHexString(eight2, " ")}`);

// let crc = crc32(seven) ^ 0xFFFFFFFF;
// console.log(`CRC (7-bit): ${bytesToHexString(new Uint8Array([crc & 0x7F, (crc >> 7) & 0x7F, (crc >> 14) & 0x7F, (crc >> 21) & 0x7F, (crc >> 28) & 0x7F]), " ")}`);

// toHexString(seven2eight(toUint8Array("01 02 03 04 05 06 07 08")), " ");

let confirmDialog = new ConfirmDialog("confirmDialog", "confirmLabel", "confirmButton");

let messageCounter: number = 0;
let midi: IMIDIProxy = new MIDIProxyForWebMIDIAPI();

// map from data length to previous and current data, used for comparing messages
let sysexMap = new Map<number, {previous: Uint8Array, current: Uint8Array, device: MIDIDeviceDescription, messageNumber: number}>(); 

start();
