import { MIDIProxyForWebMIDIAPI } from "./MIDIProxyForWebMIDIAPI.js";
import { DeviceID, IMIDIProxy, MessageType } from "./midiproxy.js";
import { getChannelMessage, getMIDIDeviceList, isMIDIIdentityResponse, isSysex } from "./miditools.js";
import { getExceptionErrorString, partialArrayMatch, bytesToHexString, hexStringToUint8Array, getNumberFromBits, crc32, partialArrayStringMatch, eight2seven, seven2eight, bytesWithCharactersToString, compareBuffers, setBitsFromNumber, numberToHexString } from "./tools.js";
import { EffectSettings, ZoomPatch } from "./ZoomPatch.js";
import { EffectIDMap, EffectParameterMap, ParameterValueMap, ZoomDevice } from "./ZoomDevice.js";
import { ConfirmDialog, getChildWithIDThatStartsWith, loadDataFromFile, saveBlobToFile, supportsContentEditablePlaintextOnly, getPatchNumber, togglePatchesTablePatch, getCellForMemorySlot, InfoDialog, TextInputDialog } from "./htmltools.js";
import { ZoomScreen, ZoomScreenCollection, ZoomScreenParameter } from "./ZoomScreenInfo.js";
import { ZoomPatchEditor } from "./ZoomPatchEditor.js";
import { MIDIDeviceDescription } from "./MIDIDeviceDescription.js";
import { shouldLog, LogLevel } from "./Logger.js";
import { addThruEffectToMap, extendMapWithMaxNumericalValueIndex, extendMSOGMapWithMS60BEffects, replaceEffectNamesInMap } from "./ZoomEffectMaps.js";
import zoomEffectIDsMS200DPlus from "./zoom-effect-ids-ms200dp.js"
import zoomEffectIDsFullNamesMS200DPlus from "./zoom-effect-ids-full-names-ms200dp.js";
import { ZoomPatchConverter } from "./ZoomPatchConverter.js";
import zoomEffectIDsAllZDL7 from "./zoom-effect-ids-allzdl7.js";
import zoomEffectIDsMS50GPlus from "./zoom-effect-ids-ms50gp.js";
import zoomEffectIDsMS60BPlus from "./zoom-effect-ids-ms60bp.js";
import zoomEffectIDsMS70CDRPlus from "./zoom-effect-ids-ms70cdrp.js";
import { ZoomEffectSelector } from "./ZoomEffectSelector.js";

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
    let deviceName = zoomDevices[index].deviceName;
    let version = ZoomDevice.getZoomVersionNumber(info.versionNumber);

    let row = midiDevicesTable.insertRow(1);
    let c;
    c = row.insertCell(-1); c.innerHTML = deviceName;
    c = row.insertCell(-1); c.innerHTML = bytesToHexString([info.familyCode[0]]);
    c = row.insertCell(-1); c.innerHTML = version.toString();
    c = row.insertCell(-1); c.innerHTML = info.inputName;
    c = row.insertCell(-1); c.innerHTML = info.outputName;
    c = row.insertCell(-1); c.innerHTML = bytesToHexString(info.identityResponse, " ");

    shouldLog(LogLevel.Info) && console.log(`  ${index + 1}: ${deviceName.padEnd(8)} OS v ${version} - input: ${info.inputName.padEnd(20)} output: ${info.outputName}`);
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
    shouldLog(LogLevel.Warning) && console.warn(`WARNING: Not sending MIDI message to device ${device} as the device is unknown"`);
    return;
  }
  if (output.connection != "open")
  {
    shouldLog(LogLevel.Warning) && console.warn(`WARNING: Not sending MIDI message to device ${output.name} as the port is in state "${output.connection}"`);
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
    shouldLog(LogLevel.Error) && console.error(message);
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
    shouldLog(LogLevel.Warning) && console.warn(`WARNING: Not sending MIDI message to device ${device} as the device is unknown"`);
    return;
  }
  if (output.connection != "open")
  {
    shouldLog(LogLevel.Warning) && console.warn(`WARNING: Not sending MIDI message to device ${output.name} as the port is in state "${output.connection}"`);
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
    shouldLog(LogLevel.Error) && console.error(message);
  }
}

async function start()
{
  await downloadEffectMaps();

  let success = await midi.enable().catch( (reason) => {
    shouldLog(LogLevel.Info) && console.log(getExceptionErrorString(reason));
    return;
  });

  let midiDeviceList: MIDIDeviceDescription[] = await getMIDIDeviceList(midi, midi.inputs, midi.outputs, 100, true); 

  shouldLog(LogLevel.Info) && console.log("Got MIDI Device list:");
  for (let i=0; i<midiDeviceList.length; i++)
  {
    let device = midiDeviceList[i];
    shouldLog(LogLevel.Info) && console.log(`  ${JSON.stringify(device)}`)
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

  patchEditor.setTextEditedCallback( (event: Event, type: string, initialValueString: string): boolean => {
    return handlePatchEdited(currentZoomPatch, zoomDevice, zoomDevice.effectIDMap, event, type, initialValueString);
  });

  patchEditor.setMouseMovedCallback( (cell: HTMLTableCellElement, initialValueString: string, x: number, y: number) => {
    handleMouseMoved(currentZoomPatch, zoomDevice, zoomDevice.effectIDMap, cell, initialValueString, x, y);
  });
  
  patchEditor.setMouseUpCallback( (cell: HTMLTableCellElement, initialValueString: string, x: number, y: number) => {
    handleMouseUp(currentZoomPatch, zoomDevice, zoomDevice.effectIDMap, cell, initialValueString, x, y);
  });

  patchEditor.setEffectSlotOnOffCallback((effectSlot: number, on: boolean) => {
    handleEffectSlotOnOff(currentZoomPatch, zoomDevice, zoomDevice.effectIDMap, effectSlot, on);
  });

  patchEditor.setEffectSlotMoveCallback((effectSlot: number, direction: "left" | "right") => {
    handleEffectSlotMove(currentZoomPatch, zoomDevice, zoomDevice.effectIDMap, effectSlot, direction);
  });

  patchEditor.setEffectSlotAddCallback((effectSlot: number, direction: "left" | "right") => {
    handleEffectSlotAdd(currentZoomPatch, zoomDevice, zoomDevice.effectIDMap, effectSlot, direction);
  });

  patchEditor.setEffectSlotDeleteCallback((effectSlot: number) => {
    handleEffectSlotDelete(currentZoomPatch, zoomDevice, zoomDevice.effectIDMap, effectSlot);
  });

  patchEditor.setEffectSlotSelectEffectCallback((effectSlot: number) => {
    handleEffectSlotSelectEffect(currentZoomPatch, zoomDevice, zoomDevice.effectIDMap, effectSlot);
  });

  zoomEffectSelector = new ZoomEffectSelector();
  let effectSelectors = document.getElementById("effectSelectors") as HTMLDivElement;
  effectSelectors.append(zoomEffectSelector.htmlElement);

  let effectLists: Map<string, Map<number, string>> = new Map<string, Map<number, string>>();
  effectLists.set("MS-50G+", zoomEffectIDsMS50GPlus);
  effectLists.set("MS-60B+", zoomEffectIDsMS60BPlus);
  effectLists.set("MS-70CDR+", zoomEffectIDsMS70CDRPlus);

  let zoomEffectIDsFullNamesMS200DPlusWithout1D: Map<number, string> = new Map<number, string>();
  for (let [key, value] of zoomEffectIDsFullNamesMS200DPlus.entries())
    if (key < 0x1D000000) zoomEffectIDsFullNamesMS200DPlusWithout1D.set(key, value.toLowerCase().replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase()));
  effectLists.set("MS-200D+", zoomEffectIDsFullNamesMS200DPlusWithout1D);

  effectLists.set("MS-50G", buildEffectIDList("MS-50G"));
  effectLists.set("MS-60B", buildEffectIDList("MS-60B"));
  effectLists.set("MS-70CDR", buildEffectIDList("MS-70CDR"));

  zoomEffectSelector.setHeading("Select effect");
  zoomEffectSelector.setEffectList(effectLists, zoomDevice.deviceName);

  // shouldLog(LogLevel.Info) && console.log("Call and response start");
  // let callAndResponse = new Map<string, string>();
  // let commandIndex = 0x51;
  // let device = zoomDevices[0];
  // midi.addListener(device.deviceInfo.inputID, (deviceHandle, data) => {
  //   let call = bytesToHexString([commandIndex]);
  //   let response = bytesToHexString(data, " ");
  //   callAndResponse.set(call, response);
  //   shouldLog(LogLevel.Info) && console.log(`${call} -> ${response}`)
  // });
  // let testButton: HTMLButtonElement = document.getElementById("testButton") as HTMLButtonElement;
  // testButton.addEventListener("click", (event) => {
  //   commandIndex++;
  //   sendZoomCommand(device.deviceInfo.outputID, device.deviceInfo.familyCode[0], commandIndex);
  // });
  // shouldLog(LogLevel.Info) && console.log("Call and response end");

  let testButton: HTMLButtonElement = document.getElementById("testButton") as HTMLButtonElement;
  testButton.addEventListener("click", async (event) => {
  
  //   let lsb = 0;
  //   let msb = 0
  //   let device = zoomDevices[0];
  
  //   for (let i = 0; i < 128 * 128; i++) {
  //     lsb = i &  0b0000000001111111;
  //     msb = (i & 0b0011111110000000) >> 7;
  //     let commandString = `31 00 01 ${lsb.toString(16).padStart(2, "0")} ${msb.toString(16).padStart(2, "0")}`;
  //     console.log(`${i.toString(10).padStart(6)}:   ${commandString}`)
  //     let command = hexStringToUint8Array(commandString);
  //     await sleepForAWhile(50);
  //     sendZoomCommandLong(device.deviceInfo.outputID, device.deviceInfo.familyCode[0], command);
  //   }
  
    // let effectIDMapOG = ZoomDevice.getEffectIDMapForDevice("MS-70CDR");
    // if (effectIDMapOG === undefined) {
    //   shouldLog(LogLevel.Error) && console.error(`No effect ID map found for device MS-70CDR`);
    //   return;
    // }
    
    // console.log("MS-70CDR to MS-70CDR+ non-mapped effects");

    // effectIDMapOG.forEach((effectMap, effectID) => {
    //   if (effectMap.pedal !== undefined && effectMap.pedal.has("MS-70CDR")) {
    //     let mapped = zoomPatchConverter.canMapEffect(effectID);
    //     if (!mapped)
    //       console.log(`${mapped ? "o" : "-" } ${effectMap.name.padEnd(12, " ")}`);   
    //   }
    // });

    // console.log("MS-70CDR to MS-70CDR+ non-mapped parameters");

    // effectIDMapOG.forEach((effectMap, inputEffectID) => {
    //   if (effectMap.pedal !== undefined && effectMap.pedal.has("MS-70CDR")) {
    //     let mapped = zoomPatchConverter.canMapEffect(inputEffectID);
    //     if (mapped) {
    //       let [outputEffectID, outputEffectName] = zoomPatchConverter.getMappedEffect(inputEffectID);
    //       effectMap.parameters.forEach((parameterMap) => {
    //         let [mapped, alternatives] = zoomPatchConverter.canMapParameter(inputEffectID, parameterMap.name);
    //         if (!mapped || alternatives.length > 0) {
    //           console.log(`${mapped ? "?": "-"} ${effectMap.name.padEnd(12, " ")} -> ${outputEffectName.padEnd(12, " ")} - ${parameterMap.name.padEnd(10, " ")}. Alternatives: ${alternatives}.`);
    //         }
    //       });
    //     };
    //   };
    // });

    console.log("Checking effect param commands");

    let device = zoomDevices[0];
    let value = 0x3F;
    let valueMax = 0x09;
    for (let commandNum = 0x03; commandNum < 0x14; commandNum++) {
      for (value = 0; value <= valueMax; value++) {
      let commandString = `64 20 00 64 ${commandNum.toString(16).padStart(2, "0")} ${value.toString(16).padStart(2, "0")} 00 00 00 00`;
      // if ([0, 1, 2, 3, 4, 7, 8, 9, 0x0C, 0x0D, 0x0E, 0x0F, 0x14, 0x1E, 0x1F].includes(commandNum)) {
      if ([0, 1, 2, 4, 7, 8, 0x0F, 0x14, 0x1E, 0x1F].includes(commandNum)) {
        console.warn(`  ${commandString} skipped`);
        continue;
      }
      console.warn(`  ${commandString} value: 0x${value.toString(16).padStart(2, "0")}               ${value.toString(2).padStart(8, "0")}`);
      let command = hexStringToUint8Array(commandString);
      sendZoomCommandLong(device.deviceInfo.outputID, device.deviceInfo.familyCode[0], command);
      await sleepForAWhile(30);
      await zoomDevice.downloadCurrentPatch();
      await sleepForAWhile(30);
      }
    }
  });  

};

function buildEffectIDList(pedalName: string): Map<number, string>
{
  let zoomEffectIDList: Map<number, string> = new Map<number, string>();
  let effectMap = ZoomDevice.getEffectIDMapForDevice(pedalName);
  if (effectMap === undefined) {
    shouldLog(LogLevel.Error) && console.error("No effect ID map found for device ${pedalName}");
  }
  else {
    for (let [effectID, parameterMap] of effectMap) {
      if (parameterMap.pedal !== undefined && parameterMap.pedal.has(pedalName) && pedalName !== "THRU")
        zoomEffectIDList.set(effectID, parameterMap.name);
    }
  }
  return zoomEffectIDList;
}

type EffectParameterMapInput = {
  name: string,
  pedal?: { [key: string]: number }, // object with pedal name as key and version as value 
  screenName: null | string,
  parameters: Array<ParameterValueMap>
};

async function downloadEffectMaps() {

  let startTime = performance.now();
  let obj = await downloadJSONResource("zoom-effect-mappings-ms50gp.json");
  shouldLog(LogLevel.Info) && console.log(`Downloading took  ${((performance.now() - startTime) / 1000).toFixed(3)} seconds ***`);
  let mapForMS50GPlus: Map<number, EffectParameterMap> = new Map<number, EffectParameterMap>(Object.entries(obj).map(([key, value]) => [parseInt(key, 16), value as EffectParameterMap]));
  shouldLog(LogLevel.Info) && console.log(`mapForMS50GPlus.size = ${mapForMS50GPlus.size}`);
  
  startTime = performance.now();
  obj = await downloadJSONResource("zoom-effect-mappings-ms70cdrp.json");
  shouldLog(LogLevel.Info) && console.log(`Downloading took  ${((performance.now() - startTime) / 1000).toFixed(3)} seconds ***`);
  let mapForMS70CDRPlus: Map<number, EffectParameterMap> = new Map<number, EffectParameterMap>(Object.entries(obj).map(([key, value]) => [parseInt(key, 16), value as EffectParameterMap]));
  shouldLog(LogLevel.Info) && console.log(`mapForMS70CDRPlus.size = ${mapForMS70CDRPlus.size}`);

  startTime = performance.now();
  obj = await downloadJSONResource("zoom-effect-mappings-ms60bp.json");
  shouldLog(LogLevel.Info) && console.log(`Downloading took  ${((performance.now() - startTime) / 1000).toFixed(3)} seconds ***`);
  let mapForMS60BPlus: Map<number, EffectParameterMap> = new Map<number, EffectParameterMap>(Object.entries(obj).map(([key, value]) => [parseInt(key, 16), value as EffectParameterMap]));
  
  shouldLog(LogLevel.Info) && console.log(`mapForMS60BPlus.size = ${mapForMS60BPlus.size}`);
  
  startTime = performance.now();
  obj = await downloadJSONResource("zoom-effect-mappings-ms200dp.json");
  shouldLog(LogLevel.Info) && console.log(`Downloading took  ${((performance.now() - startTime) / 1000).toFixed(3)} seconds ***`);
  let mapForMS200DPlus: Map<number, EffectParameterMap> = new Map<number, EffectParameterMap>(Object.entries(obj).map(([key, value]) => [parseInt(key, 16), value as EffectParameterMap]));
  
  shouldLog(LogLevel.Info) && console.log(`mapForMS200DPlus.size = ${mapForMS200DPlus.size}`);
  
  replaceEffectNamesInMap(mapForMS200DPlus, zoomEffectIDsFullNamesMS200DPlus);

  startTime = performance.now();
  obj = await downloadJSONResource("zoom-effect-mappings-msog.json");

  shouldLog(LogLevel.Info) && console.log(`Downloading took  ${((performance.now() - startTime) / 1000).toFixed(3)} seconds ***`);
  startTime = performance.now();

  mapForMSOG = new Map<number, EffectParameterMap>(Object.entries(obj).map(([key, value]) => {
    let numericalKey = parseInt(key, 16);
    let inputValue = value as EffectParameterMapInput;
    let map: EffectParameterMap = { name: inputValue.name, screenName: inputValue.screenName, parameters: inputValue.parameters };
    if (inputValue.pedal !== undefined)
      map.pedal = new Map<string, number>(Object.entries(inputValue.pedal));
    return [numericalKey, map];
  }));

  shouldLog(LogLevel.Info) && console.log(`mapForMSOG.size = ${mapForMSOG.size}`);

  extendMSOGMapWithMS60BEffects(mapForMSOG);
  shouldLog(LogLevel.Info) && console.log(`mapForMSOG.size (after extending with MS-60B IDs) = ${mapForMSOG.size}`);
  
  // merge maps
  mapForMS50GPlusAndMS70CDRPlus = mapForMS50GPlus;
  mapForMS70CDRPlus.forEach((value, key) => {
    // if (mapForMS50GPlusAndMS70CDRPlus.has(key)) {
    //   shouldLog(LogLevel.Warning) && console.warn(`Warning: Overriding effect ${mapForMS50GPlusAndMS70CDRPlus.get(key)!.name} for MS-50G+ with MS-70CDR+ effect "${value.name}" 0x${key.toString(16).padStart(8, "0")}`);
    // }
    mapForMS50GPlusAndMS70CDRPlus!.set(key, value);
  });
  
  addThruEffectToMap(mapForMS50GPlusAndMS70CDRPlus);
  addThruEffectToMap(mapForMS60BPlus);
  addThruEffectToMap(mapForMS200DPlus);
  
  extendMapWithMaxNumericalValueIndex(mapForMSOG);
  extendMapWithMaxNumericalValueIndex(mapForMS50GPlusAndMS70CDRPlus);
  extendMapWithMaxNumericalValueIndex(mapForMS60BPlus);
  extendMapWithMaxNumericalValueIndex(mapForMS200DPlus);

  // print some stats
  console.log("MS-50G+ and MS-70CDR+ VOL defaults");
  mapForMS50GPlusAndMS70CDRPlus.forEach((effectMap, key) => {
    effectMap.parameters.forEach((parameterMap) => {
      // if (parameterMap.maxNumerical !== undefined && parameterMap.maxNumerical > 151) {
      //   console.log(`Effect ${effectMap.name.padEnd(12, " ")} parameter ${parameterMap.name.padEnd(10, " ")} has max numerical value ${parameterMap.maxNumerical.toString().padStart(4, " ")}`);
      // }
      if (parameterMap.name.toLowerCase() === "vol") {
        console.log(`Effect ${effectMap.name.padEnd(12, " ")} parameter ${parameterMap.name.padEnd(10, " ")} default value ${parameterMap.default?.toString().padStart(4, " ")}`);
      }
    })
  });

  console.log("MS-OG Level defaults");
  mapForMSOG.forEach((effectMap, key) => {
    effectMap.parameters.forEach((parameterMap) => {
      // if (parameterMap.maxNumerical !== undefined && parameterMap.maxNumerical > 151) {
      //   console.log(`Effect ${effectMap.name.padEnd(12, " ")} parameter ${parameterMap.name.padEnd(10, " ")} has max numerical value ${parameterMap.maxNumerical.toString().padStart(4, " ")}`);
      // }
      if (parameterMap.name.toLowerCase() === "level") {
        console.log(`Effect ${effectMap.name.padEnd(12, " ")} parameter ${parameterMap.name.padEnd(10, " ")} default value ${parameterMap.default?.toString().padStart(4, " ")}`);
      }
    })
  });

  ZoomDevice.setEffectIDMap(["MS-50G", "MS-60B", "MS-70CDR"], mapForMSOG);
  ZoomDevice.setEffectIDMap(["MS-50G+", "MS-70CDR+"], mapForMS50GPlusAndMS70CDRPlus);
  ZoomDevice.setEffectIDMap(["MS-60B+"], mapForMS60BPlus);
  ZoomDevice.setEffectIDMap(["MS-200D+"], mapForMS200DPlus);

  shouldLog(LogLevel.Info) && console.log(`parameterMap.size = ${mapForMS50GPlusAndMS70CDRPlus.size}`);
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
let isMappingEffects = false;

mapEffectsButton.addEventListener("click", async (event) => {

  let zoomDevice = zoomDevices[0];

  //     <p>This is only relevant for the G- and B-series pedals (from the AllZDL7 list), so if you have any other pedals, this mapping probably won't work. 

  let text = `
    <p>You're about to start mapping all parameters for all effects on your pedal.</p>

    <p>The mapping process will generate a mapping file that is needed for the patch editor to work for your pedal.
    This mapping file will be added to future releases of ZoomExplorer.</p>

    <p>To prevent any patch changes being saved to the pedal during mapping, auto-save will be disabled before the mapping starts.
    If you want to enable it again, you need to do so in the menu on the pedal after mapping has completed.</p>

    <p>The mapping process could take several hours. Please leave the pedal untouched while the mapping is ongoing.</p>

    <p>When the mapping is done, please click the "Save mappings" button to save the mapping to a file, and email this file to h@mmer.no. 
    Please also include the name of your pedal.</p>

    <p>Do you want to continue?</p>
  `;


  if (mapEffectsButton.innerText.includes("Cancel")) {
    zoomDevice.cancelMapping();
    mapEffectsButton.innerText = "...";
    return;
  }

  if (mappings === undefined) {
    let result = await confirmDialog.getUserConfirmation(text);

    if (!result) 
      return;

    // Select the patch with fewest effect slots in use (1 or more)
    // if (zoomDevice.currentPatch === undefined || zoomDevice.currentPatch.effectSettings === null || 
    //   zoomDevice.currentPatch.effectSettings.length != 1 || zoomDevice.currentPatch.effectSettings[0].id === 0)
    // {
    //   if (zoomDevice.patchList.length <1)
    //     await updatePatchList();

    //   let mostSuitableMemorySlot = 0;
    //   let minNumSlots = 10;
    //   let memorySlot = 0;
    //   while (memorySlot < zoomDevice.patchList.length) {
    //     let patch = zoomDevice.patchList[memorySlot];
    //     if (patch.effectSettings !== null && patch.effectSettings[0].id !== 0 && patch.effectSettings.length <= minNumSlots) {
    //       mostSuitableMemorySlot = memorySlot;
    //       minNumSlots = patch.effectSettings.length;
    //     }
    //     memorySlot++;
    //   }
    //   zoomDevice.setCurrentMemorySlot(mostSuitableMemorySlot)
    // }

    zoomDevice.setAutoSave(false);   
    zoomDevice.setCurrentEffectSlot(0); // set current effect slot to 0, to give the user a chance to monitor the mapping 

    await sleepForAWhile(600);

    mapEffectsButton.innerText = "Cancel";
    isMappingEffects = true;

    let effectList: Map<number, string> = zoomDevice.deviceName === "MS-50G+" ? zoomEffectIDsMS50GPlus : 
      zoomDevice.deviceName === "MS-60B+" ? zoomEffectIDsMS60BPlus :
      zoomDevice.deviceName === "MS-70CDR+" ? zoomEffectIDsMS70CDRPlus :
      zoomDevice.deviceName === "MS-200D+" ? zoomEffectIDsMS200DPlus : zoomEffectIDsAllZDL7;

      let effectListName: string = zoomDevice.deviceName === "MS-50G+" ? "zoomEffectIDsMS50GPlus" : 
      zoomDevice.deviceName === "MS-60B+" ? "zoomEffectIDsMS60BPlus" :
      zoomDevice.deviceName === "MS-70CDR+" ? "zoomEffectIDsMS70CDRPlus" :
      zoomDevice.deviceName === "MS-200D+" ? "zoomEffectIDsMS200DPlus" : "zoomEffectIDsAllZDL7";

    mappings = await zoomDevice.mapParameters(effectList, effectListName, (effectName: string, effectID: number, totalNumEffects: number) => {
      mapEffectsButton.innerText = `Mapping ${effectName} ${effectID}/${totalNumEffects}. Click to Cancel.`;
    });

    isMappingEffects = false;

    if (mappings === undefined) {
      mapEffectsButton.innerText = origonalMapEffectsLabel;
      infoDialog.show(`Mapping failed. See log for details.`);
      return;
    }

    mapEffectsButton.innerText = "Save mappings";

    infoDialog.show(`Mapping completed. Please click the "Save mappings" button and email the file to h@mmer.no together with the name of your pedal.`);
  }
  else {
    let json = JSON.stringify(mappings, null, 2);
    const blob = new Blob([json]);
    let filename = zoomDevice.deviceName + "-mappings.txt";
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
  c = row.insertCell(-1); c.innerHTML = device.deviceName; // FIXME: This doesn't work with unique device names.
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
  // FIXME: This doesn't use unique deviceNames. Consider having a uniqueDeviceName in the device properties
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
  let sysexString = html.replace(/<[^>]*>/g, " ").replaceAll("&nbsp;", " ").replace(/\r|\n/g, " "); // remove html tags, &nbsp;, and newlines
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
  shouldLog(LogLevel.Info) && console.log(`Memory slot changed: ${memorySlot}`);

  let selected = getCellForMemorySlot(zoomDevice, "patchesTable", memorySlot);

  let lastMemorySlot = -1;
  if (lastSelected !== null && lastSelected.dataset.memorySlot !== undefined)
    lastMemorySlot = parseInt(lastSelected.dataset.memorySlot);

  if (memorySlot !== lastMemorySlot) {
    currentZoomPatchToConvert = undefined;
    loadedPatchEditor.hide();
  }

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
  if (isMappingEffects)
    return;

  shouldLog(LogLevel.Info) && console.log(`Screen changed`);
  getScreenCollectionAndUpdateEditPatchTable(zoomDevice);
}

let muteScreenUpdate = false; // not the prettiest of designs...

function getScreenCollectionAndUpdateEditPatchTable(zoomDevice: ZoomDevice)
{
  if (muteScreenUpdate)
    return;

  let screenCollection = zoomDevice.currentScreenCollection;
  if (screenCollection === undefined && currentZoomPatch !== undefined && zoomDevice.effectIDMap !== undefined) {
    // FIXME: Not the most robust of designs... Depends on mapping being loaded and existing for that pedal.
    muteScreenUpdate = true;
    zoomDevice.updateScreens();
    muteScreenUpdate = false;
    screenCollection = zoomDevice.currentScreenCollection;
  }

  if (screenCollection === undefined)
    shouldLog(LogLevel.Warning) && console.warn("zoomDevice.screenCollection === undefined");

  let compare = previousEditScreenCollection;
  // Note: should probably take patch equality into consideration...
  if (screenCollection !== undefined &&  screenCollection.equals(previousEditScreenCollection))
    compare = lastChangedEditScreenCollection;
  else
    lastChangedEditScreenCollection = previousEditScreenCollection;
  const patchNumbertext = `${zoomDevice.deviceName} Patch:`;
  patchEditor.update(zoomDevice, screenCollection, currentZoomPatch, patchNumbertext, compare, previousEditPatch);
  previousEditScreenCollection = screenCollection;
  previousEditPatch = currentZoomPatch;
}


function handleCurrentPatchChanged(zoomDevice: ZoomDevice): void 
{
  if (isMappingEffects)
    return;

  // Handle updates to name. 
  // Don't know if we really need this for anything else.
  shouldLog(LogLevel.Info) && console.log(`Current patch changed`);
  currentZoomPatch = zoomDevice.currentPatch !== undefined ? zoomDevice.currentPatch.clone() : undefined; // a bit unsure if it's correct to use currentZoomPatch for this.... See other uses in this file.
  previousEditPatch = currentZoomPatch;
  getScreenCollectionAndUpdateEditPatchTable(zoomDevice);
}

function handlePatchChanged(zoomDevice: ZoomDevice, memorySlot: number): void 
{
  shouldLog(LogLevel.Info) && console.log(`Patch changed for memory slot ${memorySlot}`);
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
  if (isMappingEffects)
    return;

  let [messageType, channel, data1, data2] = getChannelMessage(data); 

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
        shouldLog(LogLevel.Info) && console.log(`messageLengthFromSysex = ${messageLengthFromSysex}, eightBitData.length = ${eightBitData.length}, patch.ptcfChunk.length = ${patch?.ptcfChunk?.length}`)
        let crc = crc32(eightBitData, 0, eightBitData.length - 1 - 5); // FIXME: note that 8 bit length is incorrect since it's 5 bytes too long, for the CRC we failed to ignore above
        crc = crc  ^ 0xFFFFFFFF;
        shouldLog(LogLevel.Info) && console.log(`Patch CRC (7-bit): ${bytesToHexString(new Uint8Array([crc & 0x7F, (crc >> 7) & 0x7F, (crc >> 14) & 0x7F, (crc >> 21) & 0x7F, (crc >> 28) & 0x0F]), " ")}`);
        
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
      shouldLog(LogLevel.Info) && console.log(`Received patch info message (0x06). Number of patches: ${numPatches}, patch size: ${patchSize}`)
    }
    else if (data.length === 30 && data[4] === 0x43) {
      // Bank/patch info
      let numPatches = data[5] + (data[6] << 7);
      let patchSize = data[7] + (data[8] << 7);
      let unknown = data[9] + (data[10] << 7);
      let bankSize = data[11] + (data[12] << 7);
      shouldLog(LogLevel.Info) && console.log(`Received patch info message (0x43). Number of patches: ${numPatches}, patch size: ${patchSize}, unknown: ${unknown}, bank size: ${bankSize}.`)
      shouldLog(LogLevel.Info) && console.log(`                                    Unknown: ${bytesToHexString(data.slice(13, 30-1), " ")}.`);
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

  let lastMemorySlot = -1;
  if (lastSelected !== null && lastSelected.dataset.memorySlot !== undefined)
    lastMemorySlot = parseInt(lastSelected.dataset.memorySlot);

  let memorySlot = -1;
  if (cell !== null && cell.dataset.memorySlot !== undefined)
    memorySlot = parseInt(cell.dataset.memorySlot);

  if (memorySlot !== lastMemorySlot) {
    currentZoomPatchToConvert = undefined;
    loadedPatchEditor.hide();
  }

  lastSelected = cell;

  let patchNumber = getPatchNumber(cell) - 1;
  shouldLog(LogLevel.Info) && console.log(`Patch number clicked: ${patchNumber}`);

  let device = zoomDevices[0];

  device.setCurrentMemorySlot(patchNumber);

  // let patch = device.patchList[patchNumber];
  // updatePatchInfoTable(patch);

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
//     shouldLog(LogLevel.Info) && console.log(`${sysexStringGetNextFile} -> ${response}`)
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
    bodyCell.dataset.memorySlot = `${i}`;
    bodyCell = row.cells[Math.floor(i / numPatchesPerRow) * 2 + 1];
    let name = patch.nameName != null ? patch.nameName : patch.name;
    bodyCell.innerHTML = `${name}`;
    bodyCell.dataset.memorySlot = `${i}`;
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
  label.textContent = `Effects: ${patch.numEffects}. IDs: ${idString}`;
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

      let convertedPatch: ZoomPatch | undefined = undefined;
      if (device.deviceName.includes("MS-70CDR+") && savePatch.MSOG !== null) {
        shouldLog(LogLevel.Info) && console.log(`Converting patch "${savePatch.name}" from MS to MS+`);
        let unmappedSlotParameterList: [slot: number, effectNumber: number, unmapped: boolean][];
        [convertedPatch, unmappedSlotParameterList] = zoomPatchConverter.convert(savePatch);
        if (convertedPatch === undefined) {
          shouldLog(LogLevel.Warning) && console.warn(`Conversion failed for patch "${savePatch.name}"`);
        }
        else {
          shouldLog(LogLevel.Info) && console.log(`Conversion succeeded for patch "${savePatch.name}"`);
          savePatch = convertedPatch;
        }
      }

      if (convertedPatch !== undefined) 
        updatePatchInfoTable(savePatch);

      currentZoomPatch = savePatch;
      device.uploadPatchToCurrentPatch(currentZoomPatch);
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
          shouldLog(LogLevel.Error) && console.error("Cannot upload patch to memory slot since no memory slot was selected");
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
      let sysex = device.getSysexForCurrentPatch(savePatch);
      if (sysex === undefined) {
        shouldLog(LogLevel.Warning) && console.warn(`getSysexForCurrentPatch() failed for patch "${savePatch.name}"`);
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
    let zoomDevice = zoomDevices[0];
    let [fileEnding, shortFileEnding, fileDescription] = zoomDevice.getSuggestedFileEndingForPatch();
    let data: Uint8Array | undefined;
    let filename: string | undefined;
    let fileEndings: string[] = [shortFileEnding];
    let fileDescriptions: string[] = [fileDescription];
    if (zoomDevice.deviceName.includes("MS-70CDR+")) {
      // just for development to save some time loading MSOG pathes
      // fileEndings = ["50g"].concat(fileEnding);
      // fileDescriptions = ["MS-50G patch file"].concat(fileDescription); 
      // fileEndings = ["70cdr"].concat(fileEnding);
      // fileDescriptions = ["MS-70CDR patch file"].concat(fileDescription); 
      fileEndings.push("70cdr");
      fileDescriptions.push("MS-70CDR patch file");
    }
    [data, filename] = await loadDataFromFile(fileEndings, fileDescriptions);
    if (data === undefined || filename === undefined)
      return;

    currentZoomPatchToConvert = undefined;

    if (partialArrayStringMatch(data, "PTCF")) {
        let patch = ZoomPatch.fromPatchData(data);
        updatePatchInfoTable(patch);

        if (patch !== undefined) {
          currentZoomPatchToConvert = undefined;
          loadedPatchEditor.hide();
        }

        return;
    }
    let sysexString = bytesWithCharactersToString(data);
    loadFromSysex(sysexString, zoomDevice, filename);
  });
  headerCell.appendChild(button);

  button = document.createElement("button") as HTMLButtonElement;
  button.textContent = "Load from text";
  button.id = "loadPatchFromTextButton";
  button.className = "loadSaveButtons";
  button.addEventListener("click", async (event) => {
    let zoomDevice = zoomDevices[0];

    currentZoomPatchToConvert = undefined;

    let sysexString = await textInputDialog.getUserText("Sysex text", "", "Load");

    if (sysexString.length !== 0) {
      loadFromSysex(sysexString, zoomDevice);
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
    let preampString = "";
    if (patch.prm2Buffer !== null) {
      for (let i = 0; i < patch.prm2Buffer.length; i++) {
        if ((i > 0) && (i % 32 == 0))
          unknownString += "<br/>                           ";
        unknownString += `${patch.prm2Buffer[i].toString(16).toUpperCase().padStart(2, "0")} `;
      }
      if (patch.prm2Buffer.length > 2)
        tempoString = `${patch.prm2Tempo?.toString().padStart(3)}`;
      if (patch.prm2Buffer.length > 20)
        preampString = `${patch.prm2Buffer[20].toString(2).padStart(8, "0")}`;
      if (patch.prm2Byte2Lower6Bits !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte2Lower6Bits: ${patch.prm2Byte2Lower6Bits?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte3Upper4Bits !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte3Upper4Bits: ${patch.prm2Byte3Upper4Bits?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte9Lower5Bits !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte9Lower5Bits: ${patch.prm2Byte9Lower5Bits?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte10Bit5 !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte10Bit5: ${patch.prm2Byte10Bit5?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte13 !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte13: ${patch.prm2Byte13?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte14 !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte14: ${patch.prm2Byte14?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte20Bit1And8 !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte20Bit1And8: ${patch.prm2Byte20Bit1And8?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte21Lower4Bits !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte21Lower4Bits: ${patch.prm2Byte21Lower4Bits?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte22Bits3To7 !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte22Bits3To7: ${patch.prm2Byte22Bits3To7?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte23Upper3Bits !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte23Upper3Bits: ${patch.prm2Byte23Upper3Bits?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte24 !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte24: ${patch.prm2Byte24?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte25 !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte25: ${patch.prm2Byte25?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte26 !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte26: ${patch.prm2Byte26?.toString(2).padStart(8, "0")}`);
      if (patch.prm2Byte27 !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte27: ${patch.prm2Byte27?.toString(2).padStart(8, "0")}`);      
      if (patch.prm2Byte28 !== 0)
        shouldLog(LogLevel.Warning) && console.warn(`${patch.name}: Unknown bits in prm2Byte28: ${patch.prm2Byte28?.toString(2).padStart(8, "0")}`);      
    };
    let prm2String = `${patch.PRM2} Length: ${patch.prm2Length?.toString().padStart(3, " ")}  Tempo: ${tempoString}  Patch volume: ${patch.prm2PatchVolume}  ` +
      `Edit effect slot: ${patch.prm2EditEffectSlot}<br/>` +
      `                  Invalid effect slot: ${patch.prm2InvalidEffectSlot?.toString(2).padStart(6, "0")}  ` +
      `Preamp slot: ${patch.prm2PreampSlot?.toString(2).padStart(6, "0")}  BPM slot: ${patch.prm2BPMSlot?.toString(2).padStart(6, "0")}  LineSel slot: ${patch.prm2LineSelSlot?.toString(2).padStart(6, "0")}<br/>` +
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
        if (i < effectSettingsArray.length)
        {
          let effectSettings = effectSettingsArray[i];
          let parameterString = ""; 
          for (let p=0; p<effectSettings.parameters.length; p++) {
            parameterString += effectSettings.parameters[p].toString().toUpperCase().padStart(4, " ") + " ";
          }
          effectSettingsString += `     Effect ID: ${patch.ids[i].toString(16).toUpperCase().padStart(8, "0")}  Settings: ${effectSettings.enabled ? "[ ON]" : "[OFF]"}  `;
          effectSettingsString += `ID: ${effectSettings.id.toString(16).toUpperCase().padStart(8, "0")}  Parameters: ${parameterString}<br/>`;
        }
        else {
          effectSettingsString += `     Effect ID: 00000000  Settings: [ - ]  ID: --------  Parameters: -<br/>`;
        }
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

function loadFromSysex(sysexString: string, zoomDevice: ZoomDevice, filename: string = "")
{
  let convertedData = hexStringToUint8Array(sysexString);
  let sourceString = filename.length > 0 ? `file ${filename}` : "buffer";
  if (!isSysex(convertedData)) {
    shouldLog(LogLevel.Error) && console.error(`Unknown file format in ${sourceString}`);
  }
  else if (convertedData[1] != 0x52) {
    shouldLog(LogLevel.Error) && console.error(`Sysex ${sourceString} is not for a Zoom device, device ID: ${bytesToHexString([convertedData[1]])}`);
  }
  else {
    if (convertedData.length < 5 || convertedData[3] != zoomDevice.deviceInfo.familyCode[0]) {
      shouldLog(LogLevel.Info) && console.log(`Sysex ${sourceString} is for Zoom device ID ${bytesToHexString([convertedData[3]])}, ` +
        `but attached device has device ID: ${bytesToHexString([zoomDevice.deviceInfo.familyCode[0]])}. Attempting to load patch anyway.`);
    }

    let [patchData, program, bank] = ZoomDevice.sysexToPatchData(convertedData);

    if (patchData !== undefined) {
      let patch = ZoomPatch.fromPatchData(patchData);
      updatePatchInfoTable(patch);

      if (patch.MSOG !== null && (zoomDevice.deviceName.includes("MS-70CDR+") || zoomDevice.deviceName.includes("MS-50G+")) && mapForMSOG !== undefined) {
        currentZoomPatchToConvert = patch;
        let screens = ZoomScreenCollection.fromPatchAndMappings(patch, mapForMSOG);
        loadedPatchEditor.updateFromMap("MS-70CDR", mapForMSOG, 3, screens, patch, "MS-OG patch:", undefined, undefined);
        loadedPatchEditor.show();

        loadedPatchEditor.setTextEditedCallback((event: Event, type: string, initialValueString: string): boolean => {
          return handlePatchEdited(patch, undefined, mapForMSOG, event, type, initialValueString);
        });

        loadedPatchEditor.setMouseMovedCallback((cell: HTMLTableCellElement, initialValueString: string, x: number, y: number) => {
          handleMouseMoved(patch, undefined, mapForMSOG, cell, initialValueString, x, y);
        });

        loadedPatchEditor.setMouseUpCallback((cell: HTMLTableCellElement, initialValueString: string, x: number, y: number) => {
          handleMouseUp(patch, undefined, mapForMSOG, cell, initialValueString, x, y);
        });

        loadedPatchEditor.setEffectSlotOnOffCallback((effectSlot: number, on: boolean) => {
          handleEffectSlotOnOff(patch, undefined, mapForMSOG, effectSlot, on);
        });

        loadedPatchEditor.setEffectSlotMoveCallback((effectSlot: number, direction: "left" | "right") => {
          handleEffectSlotMove(patch, undefined, mapForMSOG, effectSlot, direction);
        });

        loadedPatchEditor.setEffectSlotAddCallback((effectSlot: number, direction: "left" | "right") => {
          handleEffectSlotAdd(patch, undefined, mapForMSOG, effectSlot, direction);
        });

        loadedPatchEditor.setEffectSlotDeleteCallback((effectSlot: number) => {
          handleEffectSlotDelete(patch, undefined, mapForMSOG, effectSlot);
        });

        loadedPatchEditor.setEffectSlotSelectEffectCallback((effectSlot: number) => {
          handleEffectSlotSelectEffect(patch, undefined, mapForMSOG, effectSlot);
        });

        // Update the main patch editor with the converted patch
        convertPatchAndUpdateEditor(patch);
      }

      else
        loadedPatchEditor.hide();
    }
  }
}

function handlePatchEdited(zoomPatch: ZoomPatch | undefined, zoomDevice: ZoomDevice | undefined, effectIDMap: EffectIDMap | undefined, event: Event, type: string, initialValueString: string): boolean
{
  shouldLog(LogLevel.Info) && console.log(`Patch edited event is "${event}`);
  if (event.target === null)
    return false;
  if (zoomPatch === undefined) {
    shouldLog(LogLevel.Error) && console.error("Attempting to edit patch when zoomPatch is undefined")
    return false;
  }

  let cell = event.target as HTMLTableCellElement;
  let [effectSlot, parameterNumber] = patchEditor.getEffectAndParameterNumber(cell.id);
  shouldLog(LogLevel.Info) && console.log(`type = ${type}, cell.id = ${cell.id}, effectSlot = ${effectSlot}, parameterNumber = ${parameterNumber}`);

  if (cell.id === "editPatchTableNameID") {
    if (type === "focus") {
      shouldLog(LogLevel.Info) && console.log("focus");
      cell.innerText = zoomPatch.name !== null ? zoomPatch.name.replace(/ +$/, "") : ""; // use the full name, but remove spaces at the end
    }
    else if (type === "blur") {
      shouldLog(LogLevel.Info) && console.log(`blur - cell.innerText = ${cell.innerText}`);
      if (zoomPatch !== undefined) { 
        setPatchParameter(zoomDevice, zoomPatch, "name", cell.innerText, "name");
        cell.innerText = zoomPatch.nameTrimmed;
      }
    } else if (type === "input") {
      shouldLog(LogLevel.Info) && console.log(`Name changed to "${cell.innerText}"`);
      if (zoomPatch !== undefined) {
        zoomPatch.name = cell.innerText;
        zoomPatch.updatePatchPropertiesFromDerivedProperties();
        updatePatchInfoTable(zoomPatch);
      }
    }
  }
  else if (cell.classList.contains("editPatchTableDescription")  && type === "blur") {
    setPatchParameter(zoomDevice, zoomPatch, "descriptionEnglish", cell.innerText, "description");
  }
  else if (cell.classList.contains("editPatchTableTempoValue") && type === "focus") {
    // cell.innerText = currentZoomPatch.tempo.toString().padStart(3, "0");
  }
  else if (cell.classList.contains("editPatchTableTempoValue") && type === "blur") {
    setPatchParameter(zoomDevice, zoomPatch, "tempo", cell.innerText, "tempo");
    // cell.innerText = currentZoomPatch.tempo.toString().padStart(3, "0") + " bpm";
  }
  else if (cell.classList.contains("editPatchTableTempoValue") && type === "key") {
    if (event instanceof KeyboardEvent && event.key === "ArrowUp") {
      cell.innerText = (Number.parseInt(cell.innerText) + 1).toString().padStart(3, "0");
      setPatchParameter(zoomDevice, zoomPatch, "tempo", cell.innerText, "tempo");
    }
    else if (event instanceof KeyboardEvent && event.key === "ArrowDown") {
      cell.innerText = (Number.parseInt(cell.innerText) - 1).toString().padStart(3, "0");
      setPatchParameter(zoomDevice, zoomPatch, "tempo", cell.innerText, "tempo");
    } 
  }
  else if (effectSlot !== undefined && parameterNumber !== undefined) {
    if (zoomPatch !== undefined && zoomPatch.effectSettings !== null && effectSlot < zoomPatch.effectSettings.length) {
      let effectID: number = -1;
      effectID = zoomPatch.effectSettings[effectSlot].id;
      let valueString = cell.innerText;
      let [rawValue, maxValue] = ZoomDevice.getRawParameterValueFromStringAndMap(effectIDMap, effectID, parameterNumber, valueString);

      if (maxValue === -1 || rawValue < 0 || rawValue > maxValue) {
        return false; // mapped parameter not found, cancel edit
      }

      let updateParameter;
      if (type === "focus") {
        if (zoomPatch.currentEffectSlot !== effectSlot) {
          zoomPatch.currentEffectSlot = effectSlot;
          zoomDevice?.setCurrentEffectSlot(effectSlot);
          // currentZoomPatch.updatePatchPropertiesFromDerivedProperties();
          // zoomDevice.uploadPatchToCurrentPatch(currentZoomPatch);      
          updatePatchInfoTable(zoomPatch);
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
          let newParameterNumber = Math.min(zoomPatch.effectSettings[effectSlot].parameters.length - 1, 
            Math.max(0, parameterNumber + (event.shiftKey ? -1 : 1)));
          let cell = patchEditor.getCell(effectSlot, newParameterNumber);
          if (cell !== undefined) {
            cell.focus();
          }
        }
      }

      if (updateParameter) {
        if (zoomPatch.currentEffectSlot !== effectSlot) {
          zoomPatch.currentEffectSlot = effectSlot;
          zoomDevice?.setCurrentEffectSlot(effectSlot);
          updatePatchInfoTable(zoomPatch);
        }
        cell.innerHTML = ZoomDevice.getStringFromRawParameterValueAndMap(effectIDMap, effectID, parameterNumber, rawValue);
        setPatchParameter(zoomDevice, zoomPatch, "effectSettings", [effectSlot, "parameters", parameterNumber, rawValue], "effectSettings");
      }
    } 
  }
  return true;
}

function handleMouseMoved(zoomPatch: ZoomPatch | undefined, zoomDevice: ZoomDevice | undefined, effectIDMap: EffectIDMap | undefined, cell: HTMLTableCellElement, initialValueString: string, x: number, y: number)
{
  if (zoomPatch === undefined) {
    shouldLog(LogLevel.Error) && console.error("Attempting to edit patch when currentZoomPatch is undefined")
    return;
  }

  let [effectSlot, parameterNumber] = patchEditor.getEffectAndParameterNumber(cell.id);
  shouldLog(LogLevel.Info) && console.log(`Mouse move (${x}, ${y}) for cell.id = ${cell.id}, effectSlot = ${effectSlot}, parameterNumber = ${parameterNumber}`);

  if (effectSlot !== undefined && parameterNumber !== undefined && zoomPatch !== undefined && 
    zoomPatch.effectSettings !== null && effectSlot < zoomPatch.effectSettings.length)
  {
    let effectID: number = -1;
    effectID = zoomPatch.effectSettings[effectSlot].id;
    let currentValueString = cell.innerText;
    let [currentRawValue, maxValue] = ZoomDevice.getRawParameterValueFromStringAndMap(effectIDMap, effectID, parameterNumber, currentValueString);
    let initialRawValue;
    [initialRawValue, maxValue] = ZoomDevice.getRawParameterValueFromStringAndMap(effectIDMap, effectID, parameterNumber, initialValueString);

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
      let newValueString = ZoomDevice.getStringFromRawParameterValueAndMap(effectIDMap, effectID, parameterNumber, newRawValue);
      cell.innerHTML = newValueString;
      patchEditor.updateValueBar(cell, newRawValue, maxValue);
      shouldLog(LogLevel.Info) && console.log(`Changing value for cell.id = ${cell.id} from ${currentValueString} (${currentRawValue}) to ${newValueString} (${newRawValue})`);
      setPatchParameter(zoomDevice, zoomPatch, "effectSettings", [effectSlot, "parameters", parameterNumber, newRawValue], "effectSettings");
    }
  } 
}

function handleMouseUp(zoomPatch: ZoomPatch | undefined, zoomDevice: ZoomDevice | undefined, effectIDMap: EffectIDMap | undefined, cell: HTMLTableCellElement, initialValueString: string, x: number, y: number)
{
}

function handleEffectSlotOnOff(zoomPatch: ZoomPatch | undefined, zoomDevice: ZoomDevice | undefined, effectIDMap: EffectIDMap | undefined, effectSlot: number, on: boolean) {
  if (zoomPatch === undefined) {
    shouldLog(LogLevel.Error) && console.error("Attempting to edit patch when currentZoomPatch is undefined")
    return;
  }

  if (zoomPatch.effectSettings !== null && effectSlot < zoomPatch.effectSettings.length)
  {
    shouldLog(LogLevel.Info) && console.log(`Changing on/off state for effect slot ${effectSlot} to ${on}`);

    let parameterValue = on ? 1 : 0;
    let parameterNumber = 0;
    zoomPatch.effectSettings[effectSlot].enabled = on;
    zoomPatch.updatePatchPropertiesFromDerivedProperties();
    zoomDevice?.setEffectParameterForCurrentPatch(effectSlot, parameterNumber, parameterValue);

    updatePatchInfoTable(zoomPatch);
  }
}

function handleEffectSlotDelete(zoomPatch: ZoomPatch | undefined, zoomDevice: ZoomDevice | undefined, effectIDMap: EffectIDMap | undefined, effectSlot: number) {
  if (zoomPatch === undefined) {
    shouldLog(LogLevel.Error) && console.error("Attempting to edit patch when zoomPatch is undefined")
    return;
  }

  if (zoomPatch.effectSettings !== null && effectSlot < zoomPatch.effectSettings.length)
  {
    shouldLog(LogLevel.Info) && console.log(`Deleting effect in slot ${effectSlot}`);

    zoomPatch.deleteEffectInSlot(effectSlot);
    zoomDevice?.deleteScreenForEffectInSlot(effectSlot);
    zoomDevice?.uploadPatchToCurrentPatch(zoomPatch);

    updatePatchInfoTable(zoomPatch);
  }
}

function handleEffectSlotMove(zoomPatch: ZoomPatch | undefined, zoomDevice: ZoomDevice | undefined, effectIDMap: EffectIDMap | undefined, effectSlot: number, direction: "left" | "right") {
  if (zoomPatch === undefined) {
    shouldLog(LogLevel.Error) && console.error("Attempting to edit patch when zoomPatch is undefined")
    return;
  }

  if (zoomPatch.effectSettings !== null && effectSlot < zoomPatch.effectSettings.length)
  {
    shouldLog(LogLevel.Info) && console.log(`Moving effect in slot ${effectSlot} ${direction}`);

    if (effectSlot === 0 && direction === "right") {
      shouldLog(LogLevel.Error) && console.error(`Cannot move effect in effectSlot ${effectSlot} (the rightmost slot) to the right`);
      return;
    }

    if (effectSlot === zoomPatch.effectSettings.length - 1 && direction === "left") {
      shouldLog(LogLevel.Error) && console.error(`Cannot move effect in effectSlot ${effectSlot} (the leftmost slot) to the left`);
      return;
    }

    let destinationEffectSlot = direction === "left" ? effectSlot + 1 : effectSlot - 1;

    zoomPatch.swapEffectsInSlots(effectSlot, destinationEffectSlot);
    zoomDevice?.swapScreensForEffectSlots(effectSlot, destinationEffectSlot);
    zoomDevice?.uploadPatchToCurrentPatch(zoomPatch);

    updatePatchInfoTable(zoomPatch);
  }
}

function handleEffectSlotAdd(zoomPatch: ZoomPatch | undefined, zoomDevice: ZoomDevice | undefined, effectIDMap: EffectIDMap | undefined, effectSlot: number, direction: "left" | "right") {
  if (zoomPatch === undefined) {
    shouldLog(LogLevel.Error) && console.error("Attempting to edit patch when zoomPatch is undefined")
    return;
  }

  if (zoomPatch.effectSettings !== null && effectSlot < zoomPatch.effectSettings.length)
  {
    shouldLog(LogLevel.Info) && console.log(`Moving effect in slot ${effectSlot} ${direction}`);

    if (effectSlot === zoomPatch.maxNumEffects - 1 && direction === "left") {
      shouldLog(LogLevel.Error) && console.error(`Cannot add effect to the left of effectSlot ${effectSlot} (the leftmost slot)`);
      return;
    }
    shouldLog(LogLevel.Info) && console.log(`Adding effect ${direction} of slot ${effectSlot}`);
    effectSlot += direction === "left" ? 1 : 0;
  
    let effectSettings = new EffectSettings();
    effectSettings.id = 0; // THRU
    effectSettings.enabled = true;
    zoomPatch.addEffectInSlot(effectSlot, effectSettings);

    let screen = new ZoomScreen();
    let parameter = new ZoomScreenParameter();
    parameter.name = "OnOff";
    parameter.valueString = "1";
    screen.parameters.push(parameter);
    parameter = new ZoomScreenParameter();
    parameter.name = "THRU";
    parameter.valueString = "THRU";
    screen.parameters.push(parameter);
    zoomDevice?.addScreenForEffectInSlot(effectSlot, screen);
    zoomDevice?.uploadPatchToCurrentPatch(zoomPatch);

    updatePatchInfoTable(zoomPatch);
  }
}

function handleEffectSlotSelectEffect(zoomPatch: ZoomPatch | undefined, zoomDevice: ZoomDevice | undefined, effectIDMap: EffectIDMap | undefined, effectSlot: number)
{
  if (zoomPatch === undefined) {
    shouldLog(LogLevel.Error) && console.error("Attempting to edit patch when zoomPatch is undefined")
    return;
  }

  if (zoomPatch.effectSettings !== null && effectSlot < zoomPatch.effectSettings.length)
  {
    shouldLog(LogLevel.Info) && console.log(`Selecting effect in slot ${effectSlot}`);

    zoomEffectSelector!.getEffect(zoomPatch.effectSettings[effectSlot].id, zoomDevice ? zoomDevice.deviceName : "MS-70CDR").then(([effectID, effectName, pedalName]) => {
      console.log(`User selected effectID: ${effectID}, effectName: ${effectName}, pedalName: ${pedalName}`);

      if (effectID !== -1) {

        if (zoomPatch.effectSettings === null) {
          shouldLog(LogLevel.Error) && console.error("zoomPatch.effectSettings is null");
          return;
        }

        if (effectIDMap === undefined) {
          shouldLog(LogLevel.Error) && console.error("effectIDMap is undefined");
          return;
        }

        let effectSettings = zoomPatch.effectSettings[effectSlot];

        effectSettings.id = effectID;
        ZoomDevice.setDefaultsForEffect(effectSettings, effectIDMap);
        zoomPatch.changeEffectInSlot(effectSlot, effectSettings);

        let effectMap = effectIDMap.get(effectSettings.id);
        if (effectMap === undefined) {
          shouldLog(LogLevel.Error) && console.error(`Unable to find mapping for effect id ${numberToHexString(effectSettings.id)} in effectSlot ${effectSlot} in patch ${zoomPatch.name}`);
          return;
        }

        zoomDevice?.updateScreenForEffectInSlot(effectSlot, effectMap, effectSettings);
        zoomDevice?.uploadPatchToCurrentPatch(zoomPatch);

        updatePatchInfoTable(zoomPatch);

      }
    });
  }
}

function setPatchParameter<T, K extends keyof ZoomPatch, L extends keyof EffectSettings>(zoomDevice: ZoomDevice | undefined, zoomPatch: ZoomPatch, key: K, value: T, keyFriendlyName: string = "", 
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
        if (syncToCurrentPatchOnPedalImmediately && zoomDevice !== undefined) {
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
    if (syncToCurrentPatchOnPedalImmediately && zoomDevice !== undefined)
      zoomDevice.uploadPatchToCurrentPatch(zoomPatch);
  }

  updatePatchInfoTable(zoomPatch);

  if (currentZoomPatchToConvert !== undefined && zoomDevice === undefined) {
    convertPatchAndUpdateEditor(currentZoomPatchToConvert);
  }
}

function convertPatchAndUpdateEditor(patch: ZoomPatch)
{
    // Update the main patch editor with the converted patch
    let convertedPatch: ZoomPatch | undefined = undefined;
    shouldLog(LogLevel.Info) && console.log(`Converting patch "${patch.name}" from MS to MS+`);
    let unmappedSlotParameterList: [slot: number, effectNumber: number, unmapped: boolean][];
    [convertedPatch, unmappedSlotParameterList] = zoomPatchConverter.convert(patch);
    if (convertedPatch === undefined) {
      shouldLog(LogLevel.Warning) && console.warn(`Conversion failed for patch "${patch.name}"`);
    }
    else {
      shouldLog(LogLevel.Info) && console.log(`Conversion succeeded for patch "${patch.name}"`);
      if (mapForMS50GPlusAndMS70CDRPlus !== undefined) {
        let convertedPatchScreens = ZoomScreenCollection.fromPatchAndMappings(convertedPatch, mapForMS50GPlusAndMS70CDRPlus);
        patchEditor.updateFromMap("MS-70CDR+", mapForMS50GPlusAndMS70CDRPlus, 4, convertedPatchScreens, convertedPatch, "MS-70CDR+ patch:", undefined, undefined);
        loadedPatchEditor.clearAllCellHighlights();
        loadedPatchEditor.addCellHighlights(unmappedSlotParameterList);
      }
    }
}

async function downloadJSONResource(filename: string): Promise<any>
{
  let response = await fetch(`./${filename}`);
  if (!response.ok) {
    shouldLog(LogLevel.Error) && console.error(`Fetching file ${filename} failed with HTTP error ${response.status}`);
    return undefined;
  }
  return await response.json();
}

function testBitMangling(data:Uint8Array, startBit: number, endBit: number, value: number) {
  printBits(data);
  setBitsFromNumber(data, startBit, endBit, value);
  printBits(data);

  let value2 = getNumberFromBits(data, startBit, endBit);
  shouldLog(LogLevel.Info) && console.log(`value = ${value}, value2 = ${value2}`);
}

function printBits(data: Uint8Array)
{
  let str = "";
  for (let i = 0; i < data.length; i++) {
    str += data[i].toString(2).padStart(8, "0") + " ";
  }
  shouldLog(LogLevel.Info) && console.log(`Bits: ${str}`);
}

function testEffectSlotPattern()
{
  for (let totalNumberOfSlots = 6; totalNumberOfSlots >= 1; totalNumberOfSlots--) {
    for (let selectedEffectSlot = totalNumberOfSlots - 1; selectedEffectSlot >= 0; selectedEffectSlot--) {
      let bits = ZoomPatch.effectSlotToPrm2BitPattern(selectedEffectSlot, totalNumberOfSlots);
      let str = bits.toString(2).padStart(16, "0");
      let formattedStr = "";
      for (let i = 0; i < str.length; i++) {
        if (i % 4 === 0) {
          formattedStr += " ";
        }
        formattedStr += str.charAt(i);
      }
      console.log(`${totalNumberOfSlots} ${selectedEffectSlot} ${formattedStr}`);
    }   
  }
}


let previousEditScreenCollection: ZoomScreenCollection | undefined = undefined;
let lastChangedEditScreenCollection: ZoomScreenCollection | undefined = undefined;
let previousEditPatch: ZoomPatch | undefined = new ZoomPatch();

let confirmDialog = new ConfirmDialog("confirmDialog", "confirmLabel", "confirmButton");
let textInputDialog = new TextInputDialog("textInputDialog", "textInputLabel", "textInput", "textInputConfirmButton");
let infoDialog = new InfoDialog("infoDialog", "infoLabel", "infoOKButton");
let messageCounter: number = 0;
let midi: IMIDIProxy = new MIDIProxyForWebMIDIAPI();

// map from data length to previous and current data, used for comparing messages
let sysexMap = new Map<number, {previous: Uint8Array, current: Uint8Array, device: MIDIDeviceDescription, messageNumber: number}>(); 

let currentZoomPatch: ZoomPatch | undefined = undefined;

let zoomDevices: Array<ZoomDevice> = new Array<ZoomDevice>();

let patchEditor = new ZoomPatchEditor("editPatchTableID");

let patchEditors = document.getElementById("patchEditors") as HTMLDivElement;
let loadedPatchEditor = new ZoomPatchEditor();
patchEditors.insertBefore(loadedPatchEditor.htmlElement, patchEditors.firstChild);
loadedPatchEditor.hide();

let zoomEffectSelector: ZoomEffectSelector | undefined = undefined;
let dummyEffectSelector=document.getElementById("effectSelectorID") as HTMLDivElement;
dummyEffectSelector.style.display = "none";

let zoomPatchConverter = new ZoomPatchConverter();
let currentZoomPatchToConvert: ZoomPatch | undefined = undefined;

let mapForMSOG: Map<number, EffectParameterMap> | undefined = undefined;
let mapForMS50GPlusAndMS70CDRPlus: Map<number, EffectParameterMap> | undefined = undefined;

let value = 511;

let data = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 64, 1, 128, 0, 12, 130, 0, 0, 65]);
//let data: Uint8Array = new Uint8Array(20);
let bitpos = data.length * 8 - 1;
testBitMangling(data, bitpos, bitpos, 1);

testEffectSlotPattern();

start();
