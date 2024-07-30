import { EffectSettings, ZoomPatch } from "./ZoomPatch.js";
import { ZoomScreenCollection } from "./ZoomScreenInfo.js";
import { IMIDIProxy, MessageType } from "./midiproxy.js";
import { MIDIDeviceDescription } from "./miditools.js";
import { Throttler } from "./throttler.js";
import { crc32, eight2seven, getExceptionErrorString, getNumberOfEightBitBytes, partialArrayMatch, partialArrayStringMatch, seven2eight, bytesToHexString, hexStringToUint8Array, sleepForAWhile } from "./tools.js";
import zoomEffectIDsMS70CDRPlus from "./zoom-effect-ids-ms70cdrp.js";
import zoomEffectIDsMS50GPlus from "./zoom-effect-ids-ms50gp.js";

export type ZoomDeviceListenerType = (zoomDevice: ZoomDevice, data: Uint8Array) => void;
export type MemorySlotChangedListenerType = (zoomDevice: ZoomDevice, memorySlot: number) => void;
export type EffectParameterChangedListenerType = (zoomDevice: ZoomDevice, effectSlot: number, paramNumber: number, paramVaule: number) => void;
export type CurrentPatchChangedListenerType = (zoomDevice: ZoomDevice) => void;
export type PatchChangedListenerType = (zoomDevice: ZoomDevice, memorySlot: number) => void;
export type ScreenChangedListenerType = (zoomDevice: ZoomDevice) => void;
export type TempoChangedListenerType = (zoomDevice: ZoomDevice, tempo: number) => void;

class StringAndBytes
{
  readonly str: string;
  readonly bytes: Uint8Array;

  constructor(str: string)
  {
    this.str = str;
    this.bytes = hexStringToUint8Array(str);
  }
}

class ZoomMessageTypes
{
  success =  new StringAndBytes("00 00"); 
  sayHi = new StringAndBytes("05"); // I don't know what this command means, but the reply is 00 00, so it's a sign of life
  bankAndPatchInfoV1 =  new StringAndBytes("06"); // 06 <num patches LSB> <num patches MSB> <patch length LSB> <patch length MSB>
  requestBankAndPatchInfoV1 =  new StringAndBytes("07");
  patchDumpForMemoryLocationV1 =  new StringAndBytes("08 00 00"); // 08 00 00 <patch number> <length LSB> <length MSB>
  requestPatchDumpForMemoryLocationV1 = new StringAndBytes("09 00 00"); // 09 00 00 <patch number>
  patchDumpForCurrentPatchV1 = new StringAndBytes("28");
  requestCurrentPatchV1 = new StringAndBytes("29");
  storeCurrentPatchToMemorySlotV1 = new StringAndBytes("32");
  requestCurrentBankAndProgramV1 = new StringAndBytes("33");
  bankAndPatchInfoV2 =  new StringAndBytes("43");
  requestBankAndPatchInfoV2 =  new StringAndBytes("44");
  patchDumpForMemoryLocationV2 =  new StringAndBytes("45 00 00");
  requestPatchDumpForMemoryLocationV2 = new StringAndBytes("46 00 00");
  parameterEditEnable = new StringAndBytes("50");
  parameterEditDisable = new StringAndBytes("51");
  pcModeEnable = new StringAndBytes("52");
  pcModeDisable = new StringAndBytes("53");
  screensForCurrentPatch = new StringAndBytes("64 01");
  requestScreensForCurrentPatch = new StringAndBytes("64 02");
  patchDumpForCurrentPatchV2 = new StringAndBytes("64 12");
  requestCurrentPatchV2 = new StringAndBytes("64 13");
  parameterValueV2 = new StringAndBytes("64 20 00");
  parameterValueAcceptedV2 = new StringAndBytes("64 20 01");
  nameCharacterV2 = new StringAndBytes("64 20 00 5F");
  tempoV2 = new StringAndBytes("64 20 00 64 02");
}

export type ParameterValueMap = { 
  name: string, 
  values: Array<string>,
  max: number
};

export type EffectParameterMap = {
  name: string,
  parameters: Array<ParameterValueMap>
};

export type EffectIDMap = Map<number, EffectParameterMap>;

/**
 * @example Usage pattern for screens and current patch
 * - Manual usage:
 *   - requestScreens() will request current screen collection from pedal
 *   - object will emitScreenChangedEvent when current screen collection is received from pedal
 * - Automatic usage:
 *   - set autoRequestScreens to true
 *   - object will do its best to keep the currentScreenCollection up to date when parameters or patches changes 
 *     - parameters changed
 *     - current patch received
 */
export class ZoomDevice
{
  private _midiDevice: MIDIDeviceDescription;
  private _timeoutMilliseconds: number;
  private _midi: IMIDIProxy;
  private _isOpen: boolean = false;
  private _zoomDeviceID: number;
  private _zoomDeviceIdString: string;
  private _commandBuffers: Map<number, Uint8Array> = new Map<number, Uint8Array>();
  private static messageTypes: ZoomMessageTypes = new ZoomMessageTypes();
  private _supportedCommands: Map<string, SupportType> = new Map<string, SupportType>();
  private _throttler: Throttler = new Throttler();
  private _throttleTimeoutMilliseconds: number = 100;
  private _patchListDownloadInProgress: boolean = false;
  private _autoRequestPatchForMemorySlotInProgress: boolean = false;
  private _autoRequestPatchMemorySlotNumber: number = -1; 
  private _disableMidiHandlers: boolean = false;;
  private _cancelMapping: boolean = false;

  private _listeners: ZoomDeviceListenerType[] = new Array<ZoomDeviceListenerType>();
  private _memorySlotChangedListeners: MemorySlotChangedListenerType[] = new Array<MemorySlotChangedListenerType>();
  private _effectParameterChangedListeners: EffectParameterChangedListenerType[] = new Array<EffectParameterChangedListenerType>();
  private _currentPatchChangedListeners: CurrentPatchChangedListenerType[] = new Array<CurrentPatchChangedListenerType>();
  private _patchChangedListeners: PatchChangedListenerType[] = new Array<PatchChangedListenerType>();
  private _screenChangedListeners: ScreenChangedListenerType[] = new Array<ScreenChangedListenerType>();
  private _tempoChangedListeners: TempoChangedListenerType[] = new Array<TempoChangedListenerType>();

  private _numPatches: number = -1;
  private _patchLength: number = -1;
  private _patchesPerBank: number = -1;
  private _patchDumpForMemoryLocationV1CRCBytes: number = 0;
  private _ptcfPatchFormatSupported: boolean = false;
  private _usesBankBeforeProgramChange: boolean = false;  
  private _bankAndProgramSentOnUpdate: boolean = false
  private _bankMessagesReceived = false; // true after having received bank messages, reset when program change message received

  private _patchList: Array<ZoomPatch> = new Array<ZoomPatch>();
  private _rawPatchList: Array<Uint8Array | undefined> = new Array<Uint8Array>();

  private _autoRequestScreens: boolean = false;
  private _autoRequestPatch: boolean = false; // FIXME: Do we need this for anything other than name, and that could have its own event ?

  private _autoRequestProgramChange: boolean = false; // MSOG pedals doesn't emit program change when user changes patch, so we need to poll
  private _autoRequestProgramChangeTimerStarted: boolean = false;
  private _autoRequestProgramChangeIntervalMilliseconds: number = 500;
  private _autoRequestProgramChangeTimerID: number = 0;
  private _autoRequestProgramChangeMuteLog: boolean = false;

  private _currentBank: number = -1;
  private _currentProgram: number = -1;
  private _previousBank: number = -1; // Not entirely accurate, as bank messages come in with MSB and LSB separately, but can hopefully be used to check if program has changed
  private _previousProgram: number = -1;
  private _currentEffectSlot: number = -1;
  private _currentEffectParameterNumber: number = -1;
  private _currentEffectParameterValue: number = -1;
  private _currentScreenCollectionData: Uint8Array | undefined = undefined;
  private _currentScreenCollection: ZoomScreenCollection | undefined = undefined;
  private _currentPatchData: Uint8Array | undefined = undefined; // if set, needs parsing, then will be undefined
  private _currentPatch: ZoomPatch | undefined = undefined; // if undefined, need to parse _currentPatchData, then set _currentPatchData=undefined 
  private _currentTempo: number | undefined = undefined;

  private static _effectIDMapForMSPlus: EffectIDMap | undefined = undefined;
  private static _effectIDMapForMSOG: EffectIDMap | undefined = undefined; 
  private _isMSOG: boolean = false; // Note: Try not to use this much, as we'd rather rely on probing

  public loggingEnabled: boolean = true;

  constructor(midi: IMIDIProxy, midiDevice: MIDIDeviceDescription, timeoutMilliseconds: number = 300)
  {
    this._midiDevice = midiDevice;
    this._timeoutMilliseconds = timeoutMilliseconds;
    this._midi = midi;
    this._zoomDeviceID = this._midiDevice.familyCode[0];
    this._zoomDeviceIdString = this._zoomDeviceID.toString(16).padStart(2, "0");

    // pre-allocate command buffers for messages of length 6 to 15
    for (let i=6; i<15; i++)
      this.getCommandBufferFromData(new Uint8Array(i-5));
  }

  public async open()
  {
    this._isOpen = true;
    await this._midi.openInput(this._midiDevice.inputID);
    await this._midi.openOutput(this._midiDevice.outputID);
    this.connectMessageHandler();
    await this.probeDevice();
    this.startAutoRequestProgramChangeIfNeeded();
  }

  public async close()
  {
    // FIXME: Disconnect handlers here
    this._isOpen = false;
    this.disconnectMessageHandler();
    if (this._autoRequestProgramChangeTimerStarted) {
      clearInterval(this._autoRequestProgramChangeTimerID);
      this._autoRequestProgramChangeTimerStarted = false;
      this._autoRequestProgramChangeMuteLog = false;
    }
  }

  public addListener(listener: ZoomDeviceListenerType): void
  {
    this._listeners.push(listener);
  }

  public removeListener(listener: ZoomDeviceListenerType): void
  {
    this._listeners = this._listeners.filter( (l) => l !== listener);
  }

  public addMemorySlotChangedListener(listener: MemorySlotChangedListenerType): void
  {
    this._memorySlotChangedListeners.push(listener);
  }

  public removeMemorySlotChangedListener(listener: MemorySlotChangedListenerType): void
  {
    this._memorySlotChangedListeners = this._memorySlotChangedListeners.filter( (l) => l !== listener);
  }

  private emitMemorySlotChangedEvent() {
    for (let listener of this._memorySlotChangedListeners)
      listener(this, this.currentMemorySlotNumber);
  }

  public addEffectParameterChangedListener(listener: EffectParameterChangedListenerType): void
  {
    this._effectParameterChangedListeners.push(listener);
  }

  public removeEffectParameterChangedListener(listener: EffectParameterChangedListenerType): void
  {
    this._effectParameterChangedListeners = this._effectParameterChangedListeners.filter( (l) => l !== listener);
  }

  private emitEffectParameterChangedEvent() {
    for (let listener of this._effectParameterChangedListeners)
      listener(this, this._currentEffectSlot, this._currentEffectParameterNumber, this._currentEffectParameterValue);
  }

  public addCurrentPatchChangedListener(listener: CurrentPatchChangedListenerType): void
  {
    this._currentPatchChangedListeners.push(listener);
  }

  public removeCurrentPatchChangedListener(listener: CurrentPatchChangedListenerType): void
  {
    this._currentPatchChangedListeners = this._currentPatchChangedListeners.filter( (l) => l !== listener);
  }

  private emitCurrentPatchChangedEvent() {
    for (let listener of this._currentPatchChangedListeners)
      listener(this);
  }

  public addPatchChangedListener(listener: PatchChangedListenerType): void
  {
    this._patchChangedListeners.push(listener);
  }

  public removePatchChangedListener(listener: PatchChangedListenerType): void
  {
    this._patchChangedListeners = this._patchChangedListeners.filter( (l) => l !== listener);
  }

  private emitPatchChangedEvent(memorySlot: number) {
    for (let listener of this._patchChangedListeners)
      listener(this, memorySlot);
  }

  public addScreenChangedListener(listener: ScreenChangedListenerType): void
  {
    this._screenChangedListeners.push(listener);
  }

  public removeScreenChangedListener(listener: ScreenChangedListenerType): void
  {
    this._screenChangedListeners = this._screenChangedListeners.filter( (l) => l !== listener);
  }

  private emitScreenChangedEvent() {
    for (let listener of this._screenChangedListeners)
      listener(this);
  }

  public addTempoChangedListener(listener: TempoChangedListenerType): void
  {
    this._tempoChangedListeners.push(listener);
  }

  public removeTempoChangedListener(listener: TempoChangedListenerType): void
  {
    this._tempoChangedListeners = this._tempoChangedListeners.filter( (l) => l !== listener);
  }

  private emitTempoChangedEvent() {
    let tempo = this._currentTempo ?? 0; 
    for (let listener of this._tempoChangedListeners)
      listener(this, tempo);
  }

  public static setEffectIDMapForMSOG(effectIDMap: EffectIDMap)
  {
    ZoomDevice._effectIDMapForMSOG = effectIDMap; 
  }

  public static setEffectIDMap(effectIDMap: EffectIDMap)
  {
    ZoomDevice._effectIDMapForMSPlus = effectIDMap; 
  }

  public parameterEditEnable() 
  {
    this.sendCommand(ZoomDevice.messageTypes.parameterEditEnable.bytes);
  }

  public parameterEditDisable() 
  {
    this.sendCommand(ZoomDevice.messageTypes.parameterEditDisable.bytes);
  }

  public pcModeEnable() 
  {
    this.sendCommand(ZoomDevice.messageTypes.pcModeEnable.bytes
    );
  }

  public pcModeDisable() 
  {
    this.sendCommand(ZoomDevice.messageTypes.pcModeEnable.bytes);
  }

  // public async getCurrentBankAndProgram() : Promise<[number, number]> 
  // {
  //   // perhaps request it ?
  //   return [this._currentBank, this._currentProgram];
  // }

  public setCurrentBankAndProgram(bank: number, program: number)
  {
    this._midi.sendCC(this._midiDevice.outputID, 0, 0x00, 0x00); // bank MSB = 0
    this._midi.sendCC(this._midiDevice.outputID, 0, 0x20, bank & 0x7F); // bank LSB
    this._midi.sendPC(this._midiDevice.outputID, 0, program & 0x7F); // program
    
    this._previousBank = this._currentBank;
    this._previousProgram = this._currentProgram;
    this._currentBank = bank;
    this._currentProgram = program;
    
    if (this._autoRequestProgramChangeTimerStarted)
      this.emitMemorySlotChangedEvent();
}

  public setCurrentMemorySlot(memorySlot: number)
  {
    if (this._patchesPerBank !== -1) {
      let bank = Math.floor(memorySlot / this._patchesPerBank);
      let program = memorySlot % this._patchesPerBank;
      this.setCurrentBankAndProgram(bank, program);
    }
    else {
      this._midi.sendPC(this._midiDevice.outputID, 0, memorySlot & 0x7F); // program
      
      this._previousProgram = this._currentProgram;
      this._currentProgram = memorySlot;
      
      if (this._autoRequestProgramChangeTimerStarted)
        this.emitMemorySlotChangedEvent();
    }
  }

  public logMutedTemporarilyForPollMessages(data: Uint8Array): boolean
  {
    let [messageType, channel, data1, data2] = this._midi.getChannelMessage(data); 
    const messageIsPCOrBankChange = messageType === MessageType.PC || (messageType === MessageType.CC && (data1 === 0x00 || data1 == 0x20));
    return this._autoRequestProgramChangeMuteLog && messageIsPCOrBankChange;
  }

  public get autoRequestScreens(): boolean
  {
    return this._autoRequestScreens;
  }

  public set autoRequestScreens(value: boolean)
  {
    this._autoRequestScreens = value;
  }

  public get autoRequestPatch(): boolean
  {
    return this._autoRequestPatch;
  }

  public set autoRequestPatch(value: boolean)
  {
    this._autoRequestPatch = value;
  }

  public get autoRequestProgramChange(): boolean
  {
    return this._autoRequestProgramChange;
  }

  public set autoRequestProgramChange(value: boolean)
  {
    if (this._autoRequestProgramChangeTimerStarted && !value) {    // switch timer off
      this._autoRequestProgramChangeTimerStarted = false;
      this._autoRequestProgramChange = value;
      clearInterval(this._autoRequestProgramChangeTimerID);
    } 
    else if (!this._autoRequestProgramChangeTimerStarted && value) { // switch timer on
      this._autoRequestProgramChange = value;
      this.startAutoRequestProgramChangeIfNeeded();
    }
    else
      this._autoRequestProgramChange = value;
  }

  public get currentPatch(): ZoomPatch | undefined
  {
    if (this._currentPatchData !== undefined) {
      // parse the last current patch data received and update current patch

      let offset = this.isMessageType(this._currentPatchData, ZoomDevice.messageTypes.patchDumpForCurrentPatchV1) ? 5 : 9
      let eightBitData = seven2eight(this._currentPatchData, offset, this._currentPatchData.length-2); // skip the last byte (0x7F)in the sysex message
      if (eightBitData !== undefined) {
        let patch = ZoomPatch.fromPatchData(eightBitData);
        if (patch !== undefined) {
          this._currentPatch = patch;
          Object.freeze(this._currentPatch);
        }
      }
      this._currentPatchData = undefined;
    }

    return this._currentPatch;
  }

  public get currentScreenCollection(): ZoomScreenCollection | undefined
  {
    if (this._currentScreenCollectionData !== undefined) {
      // parse the last screen data received and update current screen collection
      let offset = 6;
      let screenCollection: ZoomScreenCollection = ZoomScreenCollection.fromScreenData(this._currentScreenCollectionData, offset);
      if (screenCollection !== undefined)
        this._currentScreenCollection = screenCollection;
      this._currentScreenCollectionData = undefined;
    }

    return this._currentScreenCollection;
  }

  public get currentTempo(): number | undefined
  {
    return this._currentTempo;
  }

  public async downloadCurrentPatch() : Promise<ZoomPatch | undefined>
  {
    let reply: Uint8Array | undefined;
    let eightBitData: Uint8Array | undefined = undefined;

    if (this._supportedCommands.get(ZoomDevice.messageTypes.requestCurrentPatchV2.str) === SupportType.Supported) {
      reply = await this.sendCommandAndGetReply(ZoomDevice.messageTypes.requestCurrentPatchV2.bytes, 
        received => this.zoomCommandMatch(received, ZoomDevice.messageTypes.patchDumpForCurrentPatchV2.bytes));
      if (reply !== undefined) {
        let offset = 9;
        eightBitData = seven2eight(reply, offset, reply.length-2); // skip the last byte (0x7F)in the sysex message
      }
    }
    else { 
      reply = await this.sendCommandAndGetReply(ZoomDevice.messageTypes.requestCurrentPatchV1.bytes, 
        received => this.zoomCommandMatch(received, ZoomDevice.messageTypes.patchDumpForCurrentPatchV1.bytes));
      // FIXME: Untested code below, used to return data buffer, not patch
      if (reply !== undefined) {
        let offset = 5;
        eightBitData = seven2eight(reply, offset, reply.length-2);
      }
    }
    if (eightBitData != undefined) {
      this._currentPatchData = undefined;
      this._currentPatch = ZoomPatch.fromPatchData(eightBitData);
      Object.freeze(this._currentPatch);
      return this._currentPatch;
    }
    else
      return undefined;
  }

  public requestCurrentPatch() 
  {
    if (this._supportedCommands.get(ZoomDevice.messageTypes.requestCurrentPatchV2.str) === SupportType.Supported)
      this.sendCommand(ZoomDevice.messageTypes.requestCurrentPatchV2.bytes);
    else 
      this.sendCommand(ZoomDevice.messageTypes.requestCurrentPatchV1.bytes);
  }

  /**
   * 
   * @param skipCommandCheck send the midi command even if we don't know if it's supported
   * @param timeoutMilliseconds 
   * @returns [bank | undefined, program | undefined]
   */
  public async getCurrentBankAndProgram(skipCommandCheck: boolean = false, timeoutMilliseconds: number = this._timeoutMilliseconds): Promise<[number | undefined, number | undefined]>
  {
    if (!skipCommandCheck && this._supportedCommands.get(ZoomDevice.messageTypes.requestCurrentBankAndProgramV1.str) !== SupportType.Supported)
      return [undefined, undefined];

    let bank = -1;
    let program = -1;
    let reply = await this.sendCommandAndGetReply(ZoomDevice.messageTypes.requestCurrentBankAndProgramV1.bytes, (received) => {
      // expected reply is 2 optional bank messages (B0 00 00, B0 20 NN) and then one program change message (C0 NN)
      let [messageType, channel, data1, data2] = this._midi.getChannelMessage(received);
        if (messageType === MessageType.CC && data1 === 0x00) {
          if (bank === -1) bank = 0;
          bank = bank | (data2<<7);
          return false;
        }
        else if (messageType === MessageType.CC && data1 === 0x20) {
          if (bank === -1) bank = 0;
          bank = bank | data2;
          return false;
        }
        else if (messageType === MessageType.PC) {
          program = data1;
          return true;
        }
        else
          return false;
      }, null, null, timeoutMilliseconds); 

    if (program === -1)
      return [undefined, undefined];

    this._previousProgram = this._currentProgram;
    this._currentProgram = program;

    if (bank !== -1) {
      this._previousBank = this._currentBank;
      this._currentBank = bank;
    }
        
    return [bank !== -1 ? bank : undefined, program];
  }

  public async getCurrentMemorySlotNumber(): Promise<number | undefined>
  {
    let [bank, program] = await this.getCurrentBankAndProgram();
    
    if (program !== undefined && this._patchesPerBank !== -1 && bank !== undefined)
      program += bank * this._patchesPerBank;
    
    return program;
  }

  public async downloadScreens(startScreen: number = 0, endScreen: number = 12): Promise<ZoomScreenCollection | undefined>
  {
    if (!(this._supportedCommands.get(ZoomDevice.messageTypes.requestScreensForCurrentPatch.str) === SupportType.Supported)) {
      console.warn(`Attempting to get screens when the command is not supported by the device (${this._midiDevice.deviceName})`);
      return undefined;
    }

    let reply: Uint8Array | undefined;
    let screens: Uint8Array | undefined = undefined;

    let screenRange = new Uint8Array(3);
    screenRange[0] = startScreen;
    screenRange[1] = endScreen; // anything >= 6 would get all screens on an MS+ pedal
    screenRange[2] = 0;
    let command = new Uint8Array(ZoomDevice.messageTypes.requestScreensForCurrentPatch.bytes.length + screenRange.length);
    command.set(ZoomDevice.messageTypes.requestScreensForCurrentPatch.bytes);
    command.set(screenRange, ZoomDevice.messageTypes.requestScreensForCurrentPatch.bytes.length);
      
    reply = await this.sendCommandAndGetReply(command, 
      received => this.zoomCommandMatch(received, ZoomDevice.messageTypes.screensForCurrentPatch.bytes));
    if (reply === undefined) {
      console.warn(`Didn't get a reply when asking for screens for current patch for the device (${this._midiDevice.deviceName})`);
      return undefined;
    }

    let offset = 6;
    let screenCollection: ZoomScreenCollection = ZoomScreenCollection.fromScreenData(reply, offset);
    
    return screenCollection;
  }

  public requestScreens(): void
  {
    if (!(this._supportedCommands.get(ZoomDevice.messageTypes.requestScreensForCurrentPatch.str) === SupportType.Supported)) {
      console.warn(`Attempting to get screens when the command is not supported by the device (${this._midiDevice.deviceName})`);
      return undefined;
    }

    let screenRange = new Uint8Array(3);
    screenRange[0] = 0;
    screenRange[1] = 12; // anything >= 6 really
    screenRange[2] = 0;
    let command = new Uint8Array(ZoomDevice.messageTypes.requestScreensForCurrentPatch.bytes.length + screenRange.length);
    command.set(ZoomDevice.messageTypes.requestScreensForCurrentPatch.bytes);
    command.set(screenRange, ZoomDevice.messageTypes.requestScreensForCurrentPatch.bytes.length);
      
    this.sendCommand(command);
  }

  public requestPatchFromMemorySlot(memorySlot: number)
  {
    if (this._supportedCommands.get(ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV2.str) === SupportType.Supported) {
      let bank = Math.floor(memorySlot / this._patchesPerBank);
      let program = memorySlot % this._patchesPerBank;
      let bankProgram = new Uint8Array(4);
      bankProgram[0] = bank & 0x7F;
      bankProgram[1] = (bank >> 7) & 0x7F;
      bankProgram[2] = program & 0x7F;
      bankProgram[3] = (program >> 7) & 0x7F;
      let command = new Uint8Array(ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV2.bytes.length + bankProgram.length);
      command.set(ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV2.bytes);
      command.set(bankProgram, ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV2.bytes.length);
       
      this.sendCommand(command);
    }
    else {
      // Use v1 command to download patch
      let command = new Uint8Array(ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV1.bytes.length + 1);
      command.set(ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV1.bytes);
      command[ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV1.bytes.length] = memorySlot;
       
      this.sendCommand(command);
    }
  }

  public async downloadPatchFromMemorySlot(memorySlot: number) : Promise<ZoomPatch | undefined>
  {
    let reply: Uint8Array | undefined;
    let eightBitData: Uint8Array | undefined = undefined;

    if (this._supportedCommands.get(ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV2.str) === SupportType.Supported) {
      let bank = Math.floor(memorySlot / this._patchesPerBank);
      let program = memorySlot % this._patchesPerBank;
      let bankProgram = new Uint8Array(4);
      bankProgram[0] = bank & 0x7F;
      bankProgram[1] = (bank >> 7) & 0x7F;
      bankProgram[2] = program & 0x7F;
      bankProgram[3] = (program >> 7) & 0x7F;
      let command = new Uint8Array(ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV2.bytes.length + bankProgram.length);
      command.set(ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV2.bytes);
      command.set(bankProgram, ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV2.bytes.length);
       
      reply = await this.sendCommandAndGetReply(command, 
        received => this.zoomCommandMatch(received, ZoomDevice.messageTypes.patchDumpForMemoryLocationV2.bytes));
      if (reply !== undefined) {
        let offset = 13;
        eightBitData = seven2eight(reply, offset, reply.length-2);
      }
    }
    else {
      // Use v1 command to download patch
      let command = new Uint8Array(ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV1.bytes.length + 1);
      command.set(ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV1.bytes);
      command[ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV1.bytes.length] = memorySlot;
       
      reply = await this.sendCommandAndGetReply(command, 
        received => this.zoomCommandMatch(received, ZoomDevice.messageTypes.patchDumpForMemoryLocationV1.bytes));
      if (reply !== undefined) {
        let offset = 10;
        eightBitData = seven2eight(reply, offset, reply.length - 2 - this._patchDumpForMemoryLocationV1CRCBytes);
      }
    }
    if (eightBitData != undefined) {
      let patch = ZoomPatch.fromPatchData(eightBitData);
      return patch;
    }
    else
      return undefined;
  }

  public uploadCurrentPatch(patch: ZoomPatch, cacheCurrentPatch: boolean = true) 
  {
    let data: Uint8Array | undefined;
    if (patch.ptcfChunk !== null)
      data = patch.buildPTCFChunk();
    else
      data = patch.buildMSDataBuffer();

    if (data === undefined || data.length < 11) {
      console.error(`ZoomDevice.uploadCurrentPatch() received invalid patch parameter - possibly because of a failed ZoomPatch.buildPTCFChunk() or ZoomPatch.buildMSDataBuffer()`);
      return;
    }

    let paddedData = data;
    if (this._patchLength != -1) {
      if (data.length > paddedData.length) {
        console.error(`The length of the supplied patch data (${data.length} is greater than the patch length reported by the pedal (${this._patchLength}).`);
        return;
      }
      if (patch.MSOG !== null && this._patchLength !== data.length) {
        console.error(`The length of the supplied patch data (${data.length} doesn't match the expected patch length reported by the pedal (${this._patchLength}).`);
        return;
      }
      paddedData = new Uint8Array(this._patchLength);
      paddedData.set(data);
    }
    let sevenBitData = eight2seven(paddedData);
    this.sendCommand(sevenBitData, ZoomDevice.messageTypes.patchDumpForCurrentPatchV1.bytes);

    if (cacheCurrentPatch) {
      this._currentPatchData = undefined;
      this._currentPatch = patch.clone();
      Object.freeze(this._currentPatch);
    }
  }

  /**
   * Uploads the given patch to the specified memory slot on the pedal. The internal patch list is updated with this new patch.
   * @param patch
   * @param memorySlot Zero-based memory location. Typically between 0-49 or 0-99 depending on pedal. 
   * @param [waitForAcknowledge=true] 
   */
  public async uploadPatchToMemorySlot(patch: ZoomPatch, memorySlot: number, waitForAcknowledge: boolean = true) 
  {
    let sevenBitData: Uint8Array;
    let crcBytes: Uint8Array;
    let command: Uint8Array;

    if (patch.ptcfChunk !== null) {
      let data = patch.buildPTCFChunk();
      //let data = patch.ptcfChunk;
      if (data === undefined || data.length < 11) {
        console.error(`ZoomDevice.uploadPatchToMemorySlot() received invalid patch parameter - possibly because of a failed ZoomPatch.buildPTCFChunk()`);
        return;
      }

      let paddedData = data;
      if (this._patchLength != -1) {
        if (data.length > this._patchLength) {
          console.error(`The length of the supplied patch data (${data.length} is greater than the patch length reported by the pedal (${this._patchLength}).`);
        }
        paddedData = new Uint8Array(this._patchLength);
        paddedData.set(data);
      }
      sevenBitData = eight2seven(paddedData); 
      crcBytes = this.getSevenBitCRC(paddedData);
      let bankProgramLengthArray: Uint8Array = this.getBankProgramLengthArray(memorySlot, paddedData.length);
  
      command = new Uint8Array(ZoomDevice.messageTypes.patchDumpForMemoryLocationV2.bytes.length + bankProgramLengthArray.length);
      command.set(ZoomDevice.messageTypes.patchDumpForMemoryLocationV2.bytes); 
      command.set(bankProgramLengthArray, ZoomDevice.messageTypes.patchDumpForMemoryLocationV2.bytes.length);

    } 
    else if (patch.msogDataBuffer !== null) {
      let data = patch.buildMSDataBuffer();
      // let data = patch.msogDataBuffer;
      if (data === undefined || data.length < 11) {
        console.error(`ZoomDevice.uploadPatchToMemorySlot() received invalid patch parameter - possibly because of a failed ZoomPatch.buildMSDataBuffer()`);
        return;
      }

      if (this._patchLength != -1 && data.length > this._patchLength) {
        console.error(`The length of the supplied patch data (${data.length} is greater than the patch length reported by the pedal (${this._patchLength}).`);
      }
      sevenBitData = eight2seven(data); 
      crcBytes = this.getSevenBitCRC(data);
      let programLengthArray: Uint8Array = this.getProgramLengthArray(memorySlot, data.length);
  
      command = new Uint8Array(ZoomDevice.messageTypes.patchDumpForMemoryLocationV1.bytes.length + programLengthArray.length);
      command.set(ZoomDevice.messageTypes.patchDumpForMemoryLocationV1.bytes);
      command.set(programLengthArray, ZoomDevice.messageTypes.patchDumpForMemoryLocationV1.bytes.length);
    }
    else
    {
      console.error(`ZoomDevice.uploadPatchToMemorySlot() received Invalid patch parameter (no ptcf chunk and no MSOG data)`);
      return;
    }

    if (waitForAcknowledge) {
      let reply: Uint8Array | undefined = await this.sendCommandAndGetReply(sevenBitData, received => this.zoomCommandMatch(received, ZoomDevice.messageTypes.success.bytes), command, crcBytes);
      if (reply === undefined) {
        console.warn(`Didn't get reply after uploading patch ${patch.name} to memory slot ${memorySlot}`);
      }
    }
    else
      this.sendCommand(sevenBitData, command, crcBytes);

    if (memorySlot < this._patchList.length) {
      let clonedPatch = patch.clone();
      Object.freeze(clonedPatch);
      this._patchList[memorySlot] = clonedPatch;
      this._rawPatchList[memorySlot] = undefined;
    }
  }

  public async updatePatchListFromPedal()
  {
    this._patchListDownloadInProgress = true;
    if (this._numPatches === -1) {
      console.warn("Attempting to download patches from pedal without knowing how many patches are stored on the pedal (this._numPatches = -1)");
    }
    let maxNumPatches = this._numPatches === -1 ? 500 : this._numPatches;  
    if (this._patchList.length !== maxNumPatches)
      this._patchList = new Array<ZoomPatch>(maxNumPatches);
    for (let i=0; i<maxNumPatches; i++) {
      let patch = await this.downloadPatchFromMemorySlot(i)
      if (patch === undefined) {
        console.log(`Got no reply for patch number ${i} while attempting to download patches from device ${this._midiDevice.deviceName}`);
        this._patchList.splice(i);
        this._numPatches = i;
        break;
      }
      Object.freeze(patch);
      this._patchList[i] = patch;
      this._rawPatchList[i] = undefined;
    }
    this._patchListDownloadInProgress = false;
  }

  public get deviceInfo() : MIDIDeviceDescription
  {
    return this._midiDevice;
  }

  public get currentMemorySlotNumber(): number {
    let memorySlot = this._currentProgram;
    if (this._patchesPerBank !== -1 && this._currentBank !== -1)
      memorySlot += this._currentBank * this._patchesPerBank;
    return memorySlot;
  }

  public get patchList(): Readonly<Array<Readonly<ZoomPatch>>>
  {
    this.syncPatchList();
    return this._patchList;
  }

  /**
   * Makes sure the patchList is updated with the latest unparsed patches.
   * Received patches aren't parsed immediately, since that is a semi-expensive operation 
   * and the MS Plus pedals will send patch messages a few seconds after parameter edit.
   */
  private syncPatchList(): void
  {
    for (let i = 0; i < this._rawPatchList.length; i++) {
      let data = this._rawPatchList[i];
      if (data !== undefined) {
        this._rawPatchList[i] = undefined;
        let [patch, memorySlot] = this.parsePatchFromMemorySlot(data);
        if (patch === undefined || memorySlot === undefined)
          console.warn(`Error when parsing patch from memory slot, data.length: ${data.length}, patch: ${patch}, memorySlot: ${memorySlot}`);
        else if (memorySlot !== i)
          console.warn(`Parsed patch is for memory slot ${memorySlot} but expected memory slot to be ${i}`);
        else {
          Object.freeze(patch);
          this._patchList[memorySlot] = patch;
        }
      }  
    }
  }

  public getSysexForCurrentPatch(patch: ZoomPatch): Uint8Array | undefined
  {
    let data: Uint8Array | undefined;
    if (patch.PTCF !== null) {
      data = patch.buildPTCFChunk();
      // FIXME: Untested code
    }
    else {
      data = patch.buildMSDataBuffer();
      // if (patch.msogDataBuffer !== null && this.isCommandSupported(ZoomDevice.messageTypes.requestCurrentPatchV1)) {
      //   let sevenBitData = eight2seven(patch.msogDataBuffer);
      //   return this.getCommandBufferFromData(sevenBitData, ZoomDevice.messageTypes.patchDumpForCurrentPatchV1.bytes, null, false);
      // }
    }

    if (data !== undefined && this.isCommandSupported(ZoomDevice.messageTypes.requestCurrentPatchV1)) {
      let sevenBitData = eight2seven(data);
      return this.getCommandBufferFromData(sevenBitData, ZoomDevice.messageTypes.patchDumpForCurrentPatchV1.bytes, null, false);
    }
      
    return undefined;
  }

  /**
   * 
   * @returns [file ending, file ending with no dots, file description]
   */
  public getSuggestedFileEndingForPatch(): [string, string, string]
  {
    let ending = "";
    let shortEnding = "";
    let description = `${this.deviceInfo.deviceName} patch file`;
    if (this.deviceInfo.deviceName.startsWith("MS-"))
      ending = this.deviceInfo.deviceName.slice(3, this.deviceInfo.deviceName.length).replace("+", "p").toLowerCase();
    if (this._ptcfPatchFormatSupported) {
      ending += ".zptc";
      shortEnding = "zptc"
    }
    else
      shortEnding = ending;
    if (ending === "")
      ending = "syx";
    return [ending, shortEnding, description];
  }

  public get isPTCFPatchFormatSupported(): boolean
  {
    return this._ptcfPatchFormatSupported;
  }

  /**
   * Converts a sysex message with 7-bit data to 8-bit patch-data
   * @param sysexData sysex message
   * @returns [8-bit patch-data, program, bank]
   */
  public static sysexToPatchData(sysexData: Uint8Array): [Uint8Array | undefined, number | undefined, number | undefined]
  {
    let program: number | undefined = undefined;
    let bank: number | undefined = undefined;
    let patchData: Uint8Array | undefined = undefined;

    let currentPatchV2 = partialArrayMatch(sysexData, ZoomDevice.messageTypes.patchDumpForCurrentPatchV2.bytes, 4);
    let memoryLocationV2 = partialArrayMatch(sysexData, ZoomDevice.messageTypes.patchDumpForMemoryLocationV2.bytes, 4);
    let currentPatchV1 = partialArrayMatch(sysexData, ZoomDevice.messageTypes.patchDumpForCurrentPatchV1.bytes, 4);
    let memoryLocationV1 = partialArrayMatch(sysexData, ZoomDevice.messageTypes.patchDumpForMemoryLocationV1.bytes, 4);

    if (! (sysexData.length > 10 && (currentPatchV2 || memoryLocationV2 || currentPatchV1 || memoryLocationV1)))
    {
      console.warn(`Attempted to convert invalid sysex of length ${sysexData.length} to patch data`)
      return [patchData, program, bank];
    }
          
    let offset = 0;
    let patchLengthFromSysex = 0;
    let numberOfCRCBytes = 0;

    if (currentPatchV1) {
      patchLengthFromSysex = 0;
      offset = 5; 
    }
    else if (memoryLocationV1) {
      // FIXME: This code is untested. In particular, I'm uncertain about the crc / length calculations.
      patchLengthFromSysex = sysexData[8] + (sysexData[9] << 7);
      offset = 10; 
      let possibleNumberOfCRCBytes = 5;
      let zeroPaddingAtEndOfPatch = 1;
      let [numberOf8BitBytes, remainder] = getNumberOfEightBitBytes(sysexData.length - offset - zeroPaddingAtEndOfPatch - possibleNumberOfCRCBytes)
      if (numberOf8BitBytes == patchLengthFromSysex) // lengths match if we account for CRC bytes
        numberOfCRCBytes = 5;
    }
    else if (currentPatchV2) {
      patchLengthFromSysex = sysexData[7] + (sysexData[8] << 7);
      offset = 9;
    }
    else { // memoryLocationV2
      patchLengthFromSysex = sysexData[11] + (sysexData[12] << 7);
      offset = 13;
    }

    patchData = seven2eight(sysexData, offset, sysexData.length - 2 - numberOfCRCBytes);

    if (patchLengthFromSysex !== 0 && patchData.length != patchLengthFromSysex) {
      console.warn(`Patch data length (${patchData.length}) does not match the patch length specified in the sysex message (${patchLengthFromSysex})`);
    }

    return [patchData, program, bank];
  }

  public static getZoomVersionNumber(versionBytes: [number, number, number, number]) : number
  {
    let versionString = String.fromCharCode(...versionBytes);
    let versionFloat = parseFloat(versionString);
    return versionFloat;
  }

  private isCommandSupported(command: StringAndBytes): boolean
  {
    return this._supportedCommands.get(command.str) === SupportType.Supported;
  }

  private startAutoRequestProgramChangeIfNeeded()
  {
    if (!this._isOpen)
      return;

    if (!this._autoRequestProgramChange)
      return;

    if (!this.isCommandSupported(ZoomDevice.messageTypes.requestCurrentBankAndProgramV1))
      return;

    // if (this.isCommandSupported(ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV1) && !this._ptcfPatchFormatSupported) {

    if (!this._bankAndProgramSentOnUpdate) {
      // This is a weak test to determine if we have an older pedal (like the original MS Series)
      // We should really determine by probing if patch changed events are sent when patches change (?). 
      //   -> then I mist see if MS+ actually does this ...
      // We assume that older pedals don't send program change messages automatically, so we have to poll instead
      this._autoRequestProgramChangeMuteLog = false;
      let device = this;
      this._autoRequestProgramChangeTimerID = setInterval(() => {
        device.autoRequestProgramChangeTimer();
      }, this._autoRequestProgramChangeIntervalMilliseconds);
      this._autoRequestProgramChangeTimerStarted = true;
      if (this.loggingEnabled)
        console.log(`Started regular polling of program change (timer ID ${this._autoRequestProgramChangeTimerID}). Muting logging of program and bank requests and the bank and program change message.`);
    }
  }

  private autoRequestProgramChangeTimer(): void
  {
    if (this._patchListDownloadInProgress)
      return; // don't send program change requests while the patch list is being downloaded

    // Temporarily mute logging, so log isn't so chatty
    let loggingEnabled = this._midi.loggingEnabled;
    this._midi.loggingEnabled = false;
    this._autoRequestProgramChangeMuteLog = true; // mute next bank change(s) and program change message, to make the log less chatty

    this.sendCommand(ZoomDevice.messageTypes.requestCurrentBankAndProgramV1.bytes);
    
    this._midi.loggingEnabled = loggingEnabled;
  }

  private getSevenBitCRC(data: Uint8Array): Uint8Array 
  {
    let crc = crc32(data, 0, data.length - 1);
    crc = crc ^ 0xFFFFFFFF;
    let crcBytes = new Uint8Array([crc & 0x7F, (crc >> 7) & 0x7F, (crc >> 14) & 0x7F, (crc >> 21) & 0x7F, (crc >> 28) & 0x0F]);
    return crcBytes;
  }

  private getBankProgramLengthArray(memorySlot: number, length: number): Uint8Array 
  {
    let bank = Math.floor(memorySlot / this._patchesPerBank);
    let program = memorySlot % this._patchesPerBank;
    let bankProgramLength = new Uint8Array(6);
    bankProgramLength[0] = bank & 0x7F;
    bankProgramLength[1] = (bank >> 7) & 0x7F;
    bankProgramLength[2] = program & 0x7F;
    bankProgramLength[3] = (program >> 7) & 0x7F;
    bankProgramLength[4] = length & 0x7F;
    bankProgramLength[5] = (length >> 7) & 0x7F;
    return bankProgramLength;
  }

  private getProgramLengthArray(memorySlot: number, length: number): Uint8Array 
  {
    let program = memorySlot;
    let programLength = new Uint8Array(3);
    programLength[0] = program & 0x7F;
    programLength[1] = length & 0x7F;
    programLength[2] = (length >> 7) & 0x7F;
    return programLength;
  }

  private parsePatchFromMemorySlot(data: Uint8Array): [patch: ZoomPatch | undefined, memorySlot: number | undefined]
  {
    let offset: number = 0;
    let crcBytes: number = 0;
    let memorySlot: number = 0;
    
    if (this.isMessageType(data, ZoomDevice.messageTypes.patchDumpForMemoryLocationV1)) {
      offset = 10;
      crcBytes = this._patchDumpForMemoryLocationV1CRCBytes;
      memorySlot = data[7]; 
    }
    else {
      offset = 13;
      crcBytes = 0;
      let bank = data[7] + ((data[8] & 0b0111111) >> 7); 
      let program = data[9] + ((data[10] & 0b0111111) >> 7); 
      if (this._patchesPerBank !== -1)
        program += bank * this._patchesPerBank;
      memorySlot = program;
    }

    let eightBitData = seven2eight(data, offset, data.length - 2 - crcBytes); // skip the last byte (0x7F)in the sysex message, and crc bytes if v1 message

    if (eightBitData !== undefined) {
      let patch = ZoomPatch.fromPatchData(eightBitData);
      return [patch, memorySlot];
    }

    return [undefined, undefined];
  }


  /**
   * Parses data as if it was a parameter update message and returns effect slot, parameter number and parameter value for the edited parameter
   * @param data MIDI data buffer
   * @returns [effectSlot, paramNumber, paramValue], on error [-1, -1, -1] will be returned
   */
  private getEffectEditParameters(data: Uint8Array): [number, number, number]
  {
    let effectSlot: number = -1;
    let paramNumber: number = -1;
    let paramValue: number = -1;
    let [messageType, channel, data1, data2] = this._midi.getChannelMessage(data); 
    if (messageType === MessageType.SysEx && data.length === 15 && data[4] === 0x64 && data[5] === 0x20) {
      // Parameter was edited on device (MS Plus series)
      effectSlot = data[7];
      paramNumber = data[8];
      paramValue = data[9] + ((data[10] & 0b01111111) << 7 );
    }
    else if (messageType === MessageType.SysEx && data.length === 10 && data[4] === 0x31) {
      // Parameter was edited on device (MS series)
      effectSlot = data[5];
      paramNumber = data[6];
      paramValue = data[7] + ((data[8] & 0b01111111) << 7 );
    }
    else {
      console.warn(`Expected effect parameter edit message but got something else. data.length = ${data.length}, message type ${messageType}.`)
    }

    return [effectSlot, paramNumber, paramValue];
  }

  private isMessageType(data: Uint8Array, messageType: StringAndBytes): boolean
  {
    if (data[0] !== MessageType.SysEx || data.length < 4 + messageType.bytes.length)
      return false;

    for (let i=0; i<messageType.bytes.length; i++)
      if (data[4 + i] != messageType.bytes[i])
        return false;

    return true;
  }

  private setDeviceType()
  {

  }

  private sendZoomCommandNumbers(...data: number[]) : void
  {
    let commandLength = 5 + data.length;
    let output = this._midi.getOutputInfo(this._midiDevice.outputID);
    if (output === undefined)
    {
      console.warn(`WARNING: Not sending MIDI message to device ${this._midiDevice.outputID} as the device is unknown"`);
      return;
    }
    if (output.connection != "open")
    {
      console.warn(`WARNING: Not sending MIDI message to device ${output.name} as the port is in state "${output.connection}"`);
      return;
    }

    let commandBuffer = this._commandBuffers.get(commandLength);
    if (commandBuffer === undefined) {
      commandBuffer = new Uint8Array(commandLength);
      commandBuffer[0] = 0xF0; 
      commandBuffer[1] = 0x52; 
      commandBuffer[3] = this._zoomDeviceID;
      commandBuffer[commandBuffer.length - 1] = 0xF7; 
      this._commandBuffers.set(commandLength, commandBuffer)
    }

    commandBuffer.set(data, 4);
  
    try 
    {
      this._midi.send(this._midiDevice.outputID, commandBuffer);
    }
    catch (err) 
    {
      let message = getExceptionErrorString(err, `for device ${output.name}`);
      console.error(message);
    }
  }

  /**
   * Builds a complete sysex message from several parts, with default caching of buffers. Caching should only be used if the result of this function is used immediately, e.g. being sent in a command and not used afterwards.
   * @param data 
   * @param prependCommand 
   * @param appendCRC 
   * @param useCachedBuffer 
   * @returns 
   */
  private getCommandBufferFromData(data: Uint8Array, prependCommand: Uint8Array | null = null, appendCRC: Uint8Array | null = null, useCachedBuffer: boolean = true) : Uint8Array
  {
    let prependCommandLength = (prependCommand !== null) ? prependCommand.length : 0; 
    let appendCRCLength = (appendCRC !== null) ? appendCRC.length : 0; 
    let commandLength = 5 + data.length + prependCommandLength + appendCRCLength;
    let commandBuffer: Uint8Array;
    if (useCachedBuffer) {
      let cachedCommandBuffer = this._commandBuffers.get(commandLength);
      if (cachedCommandBuffer === undefined) {
        cachedCommandBuffer = createCommandBuffer(commandLength, this._zoomDeviceID);
        this._commandBuffers.set(commandLength, cachedCommandBuffer);
      }
      commandBuffer = cachedCommandBuffer;
    }
    else {
      commandBuffer = createCommandBuffer(commandLength, this._zoomDeviceID);
    }

    if (prependCommand !== null)
      commandBuffer.set(prependCommand, 4);
    commandBuffer.set(data, 4 + prependCommandLength);
    if (appendCRC !== null)
      commandBuffer.set(appendCRC, 4 + prependCommandLength + data.length);
    return commandBuffer;

    function createCommandBuffer(commandLength: number, deviceID: number) {
      let commandBuffer = new Uint8Array(commandLength);
      commandBuffer[0] = 0xF0;
      commandBuffer[1] = 0x52;
      commandBuffer[3] = deviceID;
      commandBuffer[commandBuffer.length - 1] = 0xF7;
      return commandBuffer;
    }
  }

  private sendCommand(data: Uint8Array, prependCommand: Uint8Array | null = null, appendCRC: Uint8Array | null = null) : void
  {
    let output = this._midi.getOutputInfo(this._midiDevice.outputID);
    if (output === undefined)
    {
      console.warn(`WARNING: Not sending MIDI message to device ${this._midiDevice.outputID} as the device is unknown"`);
      return;
    }
    if (output.connection != "open")
    {
      console.warn(`WARNING: Not sending MIDI message to device ${output.name} as the port is in state "${output.connection}"`);
      return;
    }

    let commandBuffer = this.getCommandBufferFromData(data, prependCommand, appendCRC);
  
    try 
    {
      this._midi.send(this._midiDevice.outputID, commandBuffer);
    }
    catch (err) 
    {
      let message = getExceptionErrorString(err, `for device ${output.name}`);
      console.error(message);
    }
  }

  private async sendCommandAndGetReply(data: Uint8Array, verifyReply: (data: Uint8Array) => boolean, prependCommand: Uint8Array | null = null, appendCRC: Uint8Array | null = null,
    timeoutMilliseconds: number = this._timeoutMilliseconds) : Promise<Uint8Array | undefined>
  {
    let output = this._midi.getOutputInfo(this._midiDevice.outputID);
    if (output === undefined)
    {
      console.warn(`WARNING: Not sending MIDI message to device ${this._midiDevice.outputID} as the device is unknown"`);
      return;
    }
    if (output.connection != "open")
    {
      console.warn(`WARNING: Not sending MIDI message to device ${output.name} as the port is in state "${output.connection}"`);
      return;
    }

    let commandBuffer = this.getCommandBufferFromData(data, prependCommand, appendCRC);
  
    try 
    {
      return await this._midi.sendAndGetReply(this._midiDevice.outputID, commandBuffer, this._midiDevice.inputID, verifyReply, timeoutMilliseconds);
    }
    catch (err) 
    {
      let message = getExceptionErrorString(err, `for device ${output.name}`);
      console.error(message);
      return undefined;
    }
  }

  private zoomCommandMatch(data: Uint8Array, command: Uint8Array): boolean
  {
    return data.length >= 4 + command.length && data[0] == 0xF0 && data[data.length-1] == 0xF7 && data[1] == 0x52 && data[2] == 0 && data[3] == this._zoomDeviceID && 
      data.slice(4, 4 + command.length).every( (element, index) => element === command[index] );
  }
  

  private connectMessageHandler() 
  {
    this._midi.addListener(this._midiDevice.inputID, (deviceHandle, data) => {
      this.handleMIDIDataFromZoom(data);
    });
  }

  private disconnectMessageHandler() {
    throw new Error("Method not implemented.");
  }

  private handleMIDIDataFromZoom(data: Uint8Array): void
  {
    if (this._disableMidiHandlers) {
      if (this._midi.loggingEnabled)
        console.log(`${performance.now().toFixed(1)} Rcvd: ${bytesToHexString(data, " ")}`);
      return;
    }

    this.internalMIDIDataHandler(data);
    
    for (let listener of this._listeners)
      listener(this, data);  
    
    let [messageType, channel, data1, data2] = this._midi.getChannelMessage(data); 
    if (this._autoRequestProgramChangeMuteLog && messageType === MessageType.PC)
      this._autoRequestProgramChangeMuteLog = false; // Bank and program change message muted, don't skip logging anymore  
  }  

  private internalMIDIDataHandler(data: Uint8Array): void
  {
    let [messageType, channel, data1, data2] = this._midi.getChannelMessage(data); 
    
    // Skip log for auto requests of program change, to make the log less chatty
    const messageIsPCOrBankChange = messageType === MessageType.PC || (messageType === MessageType.CC && (data1 === 0x00 || data1 == 0x20));
    const tempSkipLog = this._autoRequestProgramChangeMuteLog && messageIsPCOrBankChange;

    if (this.loggingEnabled && ! this.logMutedTemporarilyForPollMessages(data))
      console.log(`${performance.now().toFixed(1)} Received: ${bytesToHexString(data, " ")}`);

    if (this._patchListDownloadInProgress)
      return; // mute all message handling while the patch list is being downloaded

    if (messageType === MessageType.CC && data1 === 0x00) {
      // Bank MSB
      if (this._currentBank === -1) this._currentBank = 0;
      this._previousBank = this._currentBank;
      this._currentBank = (this._currentBank & 0b0000000001111111) | (data2<<7);
      this._bankMessagesReceived = true;
    }
    else if (messageType === MessageType.CC && data1 === 0x20) { 
      // Bank LSB
      if (this._currentBank === -1) this._currentBank = 0;
      this._previousBank = this._currentBank;
      this._currentBank = (this._currentBank & 0b0011111110000000) | data2;
      this._bankMessagesReceived = true;
    }
    else if (messageType === MessageType.PC) {
      // Program change
      if (!this._usesBankBeforeProgramChange || (this._usesBankBeforeProgramChange && this._bankMessagesReceived)) {
        this._bankMessagesReceived = false;
        this._previousProgram = this._currentProgram;
        this._currentProgram = data1;

        if (!this._autoRequestProgramChangeTimerStarted || this._currentBank !== this._previousBank || this._currentProgram !== this._previousProgram)
          this.emitMemorySlotChangedEvent();
  
        // FIXME: Perhaps we should only request screens if program has changed
        if (this._autoRequestScreens && this._supportedCommands.get(ZoomDevice.messageTypes.requestScreensForCurrentPatch.str) === SupportType.Supported)
          this.requestScreens();
      }
    }
    else if (this.isMessageType(data, ZoomDevice.messageTypes.nameCharacterV2)) {
      // Name was edited on device (MS Plus series)
      // We need to get the current patch to get the name
      // We'll get a lot of these messages just for one changed character, so we'll throttle the request for current patch
      // FIXME: Consider just emitting a name changed event for this particular case, after receiving the throttled new current patch
      this._throttler.doItLater(() => {
        if (this._autoRequestPatch)
          this.requestCurrentPatch();
      }, this._throttleTimeoutMilliseconds);
    }
    else if (this.isMessageType(data, ZoomDevice.messageTypes.tempoV2)) {
      // Tempo changed on device (MS Plus series)
      this._currentTempo = data[9] + ((data[10] & 0b01111111) << 7);
      this.emitTempoChangedEvent();
    }
    else if (messageType === MessageType.SysEx && data.length === 15 && data[4] === 0x64 && data[5] === 0x20) {
      // Parameter was edited on device (MS Plus series)
      [this._currentEffectSlot, this._currentEffectParameterNumber, this._currentEffectParameterValue] = this.getEffectEditParameters(data);
      this.emitEffectParameterChangedEvent();
      if (this._autoRequestScreens && this.currentPatch !== undefined) {
        let screens: ZoomScreenCollection | undefined = undefined;
        if (ZoomDevice._effectIDMapForMSPlus !== undefined)
          screens = this._currentScreenCollection = ZoomScreenCollection.fromPatchAndMappings(this.currentPatch, ZoomDevice._effectIDMapForMSPlus);
        if (screens !== undefined) {
          this._currentScreenCollection = screens;
          this._currentScreenCollectionData = undefined;
          this.emitScreenChangedEvent();
        }
        else if (this._supportedCommands.get(ZoomDevice.messageTypes.requestScreensForCurrentPatch.str) === SupportType.Supported)
          this.requestScreens();
      }
    }
    else if (messageType === MessageType.SysEx && data.length === 10 && data[4] === 0x31) {
      // Parameter was edited on device (MS series)
      [this._currentEffectSlot, this._currentEffectParameterNumber, this._currentEffectParameterValue] = this.getEffectEditParameters(data);
      this.emitEffectParameterChangedEvent();
      if (ZoomDevice._effectIDMapForMSOG !== undefined && this.currentPatch !== undefined) {
        let screens: ZoomScreenCollection | undefined;
        screens = ZoomScreenCollection.fromPatchAndMappings(this.currentPatch, ZoomDevice._effectIDMapForMSOG);
        if (screens !== undefined) {
          this._currentScreenCollection = screens;
          this._currentScreenCollection = undefined;
          this.emitScreenChangedEvent();
        }
      }

    }
    else if (this.isMessageType(data, ZoomDevice.messageTypes.patchDumpForCurrentPatchV1) || this.isMessageType(data, ZoomDevice.messageTypes.patchDumpForCurrentPatchV2)) {
      this._currentPatch = undefined;
      this._currentPatchData = data;
      this.emitCurrentPatchChangedEvent();
      if (this._autoRequestScreens && this._supportedCommands.get(ZoomDevice.messageTypes.requestScreensForCurrentPatch.str) === SupportType.Supported)
        this.requestScreens();
    }
    else if (this.isMessageType(data, ZoomDevice.messageTypes.storeCurrentPatchToMemorySlotV1)) {
      // Current (edit) patch stored to memory slot on device (MS series)
      let memorySlot = data[8];
      if (this._autoRequestPatch) {
        if (this._autoRequestPatchForMemorySlotInProgress)
          console.warn(`Auto-requesting patch from memory slot ${memorySlot} while auto request already in progress for another memory slot ${this._autoRequestPatchMemorySlotNumber}`);
        if (memorySlot !== this.currentMemorySlotNumber)
          console.warn(`Got a message about current patch being stored to memory slot ${memorySlot}, but that is not the current memory slot number ${this.currentMemorySlotNumber}`);

        this._autoRequestPatchForMemorySlotInProgress = true;
        this._autoRequestPatchMemorySlotNumber = memorySlot;

        this.requestPatchFromMemorySlot(memorySlot);
      }
    }
    else if (this.isMessageType(data, ZoomDevice.messageTypes.patchDumpForMemoryLocationV1)) {
      let autoRequestInProgress = this._autoRequestPatchForMemorySlotInProgress;
      this._autoRequestPatchForMemorySlotInProgress = false;
      let autoRequestPatchMemorySlotNumber = this._autoRequestPatchMemorySlotNumber;
      this._autoRequestPatchMemorySlotNumber = -1;

      let memorySlot = data[7]; 

      this._rawPatchList[memorySlot] = data;
      this.emitPatchChangedEvent(memorySlot);

      if (autoRequestInProgress) {
        if (memorySlot !== autoRequestPatchMemorySlotNumber)
          console.warn(`Auto-requested patch dump for memory slot ${autoRequestPatchMemorySlotNumber} but received patch dump for memory slot ${memorySlot} instead`);

        this.emitMemorySlotChangedEvent();
      }
    }
    else if (this.isMessageType(data, ZoomDevice.messageTypes.patchDumpForMemoryLocationV2)) {
      let bank = data[7] + ((data[8] & 0b0111111) >> 7); 
      let program = data[9] + ((data[10] & 0b0111111) >> 7); 
      if (this._patchesPerBank !== -1)
        program += bank * this._patchesPerBank;
      let memorySlot = program;

      this._rawPatchList[memorySlot] = data;
      this.emitPatchChangedEvent(memorySlot);
    }
    else if (this.isMessageType(data, ZoomDevice.messageTypes.screensForCurrentPatch)) {
      this._currentScreenCollectionData = data;
      this._currentScreenCollection = undefined;
      this.emitScreenChangedEvent();
    }
  }

  private async probeCommand(command: string, parameters: string, expectedReply: string, probeTimeoutMilliseconds: number, retryWithEditMode: boolean = false) : Promise<Uint8Array | undefined>
  {
    let reply: Uint8Array | undefined;
    if (parameters.length > 0)
      parameters = " " + parameters;
    reply = await this.sendCommandAndGetReply(hexStringToUint8Array(command + parameters), (received) => 
      partialArrayMatch(received, hexStringToUint8Array(`F0 52 00 ${this._zoomDeviceIdString} ${expectedReply}`)), null, null, probeTimeoutMilliseconds);

    if (reply === undefined && retryWithEditMode) {
      // FIXME: Untested code
      console.log(`Probing for command "${command}" didn't succeed. Retrying with parameter edit enabled.`);

      this.parameterEditEnable();

      reply = await this.sendCommandAndGetReply(hexStringToUint8Array(command + parameters), (received) => 
      partialArrayMatch(received, hexStringToUint8Array(`F0 52 00 ${this._zoomDeviceIdString} ${expectedReply}`)), null, null, probeTimeoutMilliseconds);

      if (reply === undefined)
        console.log(`Probing for command "${command}" failed again.`);
      else
        console.log(`Probing for command "${command}" succeeded with parameter edit enabled.`);
  
      this.parameterEditDisable();            
    }
    this._supportedCommands.set(command, reply !== undefined ? SupportType.Supported : SupportType.Unknown);
    return reply;
  }

  private async probeDevice() 
  {
    let probeTimeoutMilliseconds = 300;

    let command: string;
    let expectedReply: string;
    let reply: Uint8Array | undefined;

    if (this.loggingEnabled)
      console.log(`Probing started for device ${this.deviceInfo.deviceName}`);

    // Some of the probes will fail if parameter edit is not enabled
    this.parameterEditEnable();

    command =ZoomDevice.messageTypes.sayHi.str;
    expectedReply = ZoomDevice.messageTypes.success.str;
    reply = await this.probeCommand(command, "", expectedReply, probeTimeoutMilliseconds);

    // This one fails sometimes on MS-50G, so we will try again further down
    command =ZoomDevice.messageTypes.requestCurrentPatchV1.str;
    expectedReply = ZoomDevice.messageTypes.patchDumpForCurrentPatchV1.str;
    reply = await this.probeCommand(command, "", expectedReply, probeTimeoutMilliseconds);

    command =ZoomDevice.messageTypes.requestCurrentPatchV2.str;
    expectedReply = ZoomDevice.messageTypes.patchDumpForCurrentPatchV2.str;
    reply = await this.probeCommand(command, "", expectedReply, probeTimeoutMilliseconds);

    command =ZoomDevice.messageTypes.requestBankAndPatchInfoV1.str;
    expectedReply = ZoomDevice.messageTypes.bankAndPatchInfoV1.str;
    reply = await this.probeCommand(command, "", expectedReply, probeTimeoutMilliseconds);
    if (reply !== undefined && reply.length == 10) {
      this._numPatches = reply[5] + (reply[6] << 7);
      this._patchLength = reply[7] + (reply[8] << 7);
    }

    command =ZoomDevice.messageTypes.requestBankAndPatchInfoV2.str;
    expectedReply = ZoomDevice.messageTypes.bankAndPatchInfoV2.str;
    reply = await this.probeCommand(command, "", expectedReply, probeTimeoutMilliseconds);
    if (reply !== undefined && reply.length > 13) {
      this._numPatches = reply[5] + (reply[6] << 7);
      this._patchLength = reply[7] + (reply[8] << 7);
      let unknown = reply[9] + (reply[10] << 7);
      this._patchesPerBank = reply[11] + (reply[12] << 7);
    }

    command = ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV1.str; 
    expectedReply = ZoomDevice.messageTypes.patchDumpForMemoryLocationV1.str + " 00"; // program 0
    reply = await this.probeCommand(command, "00", expectedReply, probeTimeoutMilliseconds);
    if (reply !== undefined) {
      let numberOfCRCBytes = 5;
      let offset = 10;
      let zeroPaddingAtEndOfPatch = 1;
      let [numberOf8BitBytes, remainder] = getNumberOfEightBitBytes(reply.length - offset - zeroPaddingAtEndOfPatch - numberOfCRCBytes)
      if (numberOf8BitBytes == this._patchLength) // lengths match if we account for CRC bytes
        this._patchDumpForMemoryLocationV1CRCBytes = 5;
      if (partialArrayStringMatch(reply, "PTCF", offset))
        this._ptcfPatchFormatSupported = true;
    }

    command = ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV2.str; 
    expectedReply = ZoomDevice.messageTypes.patchDumpForMemoryLocationV2.str + " 00 00 00 00"; // bank 0, program 0
    reply = await this.probeCommand(command, "00 00 00 00", expectedReply, probeTimeoutMilliseconds);
    if (reply !== undefined) {
      let offset = 13 + 1; 
      // the 8-bit data starts at offset 13, but reply is 7-bit data and we haven't bothered to convert to 8 bit
      // so the byte at data[13] is the high-bit-byte in the 7-bit data, and the ascii identifier starts at data[13+1] = data[14]
      if (partialArrayStringMatch(reply, "PTCF", offset))
        this._ptcfPatchFormatSupported = true;
    }

    command = ZoomDevice.messageTypes.requestCurrentBankAndProgramV1.str; 
    let [bank, program] = await this.getCurrentBankAndProgram(true, probeTimeoutMilliseconds);
    this._supportedCommands.set(command, program !== undefined ? SupportType.Supported : SupportType.Unknown);
    this._usesBankBeforeProgramChange = bank !== undefined;

    // Send program change and see if we get a reply
    bank = bank ?? 0;
    if (program !== undefined) {
      let newBank: number = 0;
      let newProgram: number = 0;
    this._midi.sendCC(this._midiDevice.outputID, 0, 0x00, 0x00); // bank MSB = 0
      this._midi.sendCC(this._midiDevice.outputID, 0, 0x20, bank & 0x7F); // bank LSB = 0
      let pcMessage = new Uint8Array(2); pcMessage[0] = 0xC0; pcMessage[1] = program & 0b01111111;
      reply = await this._midi.sendAndGetReply(this._midiDevice.outputID, pcMessage, this._midiDevice.inputID, (data: Uint8Array) => {
        // expected reply is 2 optional bank messages (B0 00 00, B0 20 NN) and then one program change message (C0 NN)
        let [messageType, channel, data1, data2] = this._midi.getChannelMessage(data);
        if (messageType === MessageType.CC && data1 === 0x00) {
          if (newBank === -1) newBank = 0;
          newBank = newBank | (data2<<7);
          return false;
        }
        else if (messageType === MessageType.CC && data1 === 0x20) {
          if (newBank === -1) newBank = 0;
          newBank = newBank | data2;
          return false;
        }
        else if (messageType === MessageType.PC) {
          newProgram = data1;
          return true;
        }
        else
          return false;
      }, probeTimeoutMilliseconds);
      if (reply !== undefined) {
        if (bank === newBank && program === newProgram) {
          this._bankAndProgramSentOnUpdate = true;
        }
        else {
          console.warn(`Set bank and program to (${bank}, ${program}) but got back (${newBank}, ${newProgram})`)
          this._bankAndProgramSentOnUpdate = false;
        }
      }
      else {
        this._bankAndProgramSentOnUpdate = false;
      }
    }

    // reply = await this.sendCommandAndGetReply(hexStringToUint8Array(command), (received) => 
    //   partialArrayMatch(received, hexStringToUint8Array(`C0`)), null, null, probeTimeoutMilliseconds); 
    // // expected reply is 2 optional bank messages (B0 00 00, B0 20 NN) and then one program change message (C0 NN)
    // this._supportedCommands.set(command, reply !== undefined ? SupportType.Supported : SupportType.Unknown);

    command = ZoomDevice.messageTypes.requestScreensForCurrentPatch.str; 
    expectedReply = ZoomDevice.messageTypes.screensForCurrentPatch.str;
    reply = await this.probeCommand(command, "", expectedReply, probeTimeoutMilliseconds);

    this._isMSOG = [0x58, 0x5F, 0x61].includes(this._zoomDeviceID);

    if (this.loggingEnabled) {
      let sortedMap = new Map([...this._supportedCommands.entries()].sort( (a, b) => a[0].replace(/ /g, "").padEnd(2, "00") > b[0].replace(/ /g, "").padEnd(2, "00") ? 1 : -1))
      console.log("Probing summery:")
      for (let [command, supportType] of sortedMap) {
        console.log(`  ${command.padEnd(8)} -> ${supportType == SupportType.Supported ? "  Supported" : "Unsupported"}`)
      }
      console.log(`  Number of patches:       ${this._numPatches}`);
      console.log(`  Patch length:            ${this._patchLength}`);
      console.log(`  Patches per bank:        ${this._patchesPerBank == -1 ? "Unknown" : this._patchesPerBank}`);
      console.log(`  CRC bytes v1 mem patch:  ${this._patchDumpForMemoryLocationV1CRCBytes}`);
      console.log(`  PTCF format support:     ${this._ptcfPatchFormatSupported}`);
      console.log(`  Bank and prog change sent on update: ${this._bankAndProgramSentOnUpdate}`);
      console.log(`  Is MSOG device:          ${this._isMSOG}`);
      
    }

    this.parameterEditDisable();

    if (this.loggingEnabled)
      console.log(`Probing ended for device ${this.deviceInfo.deviceName}`);
  }

  get effectIDMap(): EffectIDMap | undefined
  {
    return this._isMSOG ? ZoomDevice._effectIDMapForMSOG : ZoomDevice._effectIDMapForMSPlus;
  }


  /**
   * Returns the raw value (zero-based) and maximum value (zero-based) for a given effect ID, parameter number, and value string.
   *
   * @param {number} effectID - The ID of the effect.
   * @param {number} parameterNumber - The number of the parameter.
   * @param {string} valueString - The value string to search for.
   * @return {[number, number]} An array containing the raw value and maximum value. Returns [0, -1] if a mapping for valueString is not found.
   */
  getRawParameterValueFromString(effectID: number, parameterNumber: number, valueString: string): [rawValue: number, maxValue: number] 
  {
    if (this.effectIDMap === undefined)
      return [0, -1];
    let effectMapping: EffectParameterMap | undefined = this.effectIDMap.get(effectID);
    let parameterIndex = parameterNumber - 2;
    if (effectMapping !== undefined) {
      if (parameterIndex < effectMapping.parameters.length) {
        let parameterMapping: ParameterValueMap = effectMapping.parameters[parameterIndex];
        valueString = ZoomPatch.noteUTF16ToHtml(valueString);
        valueString = valueString.replace(/ /g, "").toUpperCase();
        let rawValue = parameterMapping.values.findIndex(str => str.replace(/ /g, "").toUpperCase() === valueString);
        if (rawValue >= 0)
          return [rawValue, parameterMapping.max];
      }
    }
    console.log(`No mapping for effect ${effectID}, parameter ${parameterNumber}, value ${valueString}`);
    return [0, -1];
  }

  getStringFromRawParameterValue(effectID: number, parameterNumber: number, rawValue: number): string
  {
    if (this.effectIDMap === undefined)
      return "";
    let effectMapping: EffectParameterMap | undefined = this.effectIDMap.get(effectID);
    let parameterIndex = parameterNumber - 2;
    if (effectMapping !== undefined) {
      if (parameterIndex < effectMapping.parameters.length) {
        let parameterMapping: ParameterValueMap = effectMapping.parameters[parameterIndex];
        if (rawValue < parameterMapping.values.length)
          return parameterMapping.values[rawValue];
      }
    }
    return "";
  }

  public cancelMapping()
  {
    this._cancelMapping = true;
  }

  public async mapParameters(): Promise<{ [key: string]: EffectParameterMap; } | undefined>
  {
    this._disableMidiHandlers = true;
    
    // let originalCurrentPatch = await this.downloadCurrentPatch();
    // if (originalCurrentPatch === undefined) {
    //   console.error("Failed to download current patch");
    //   return;
    // }
    // originalCurrentPatch = originalCurrentPatch.clone();

    if (this.currentPatch === undefined || this.currentPatch.effectSettings === null) {
      console.error("Cannot map parameters when currentPatch == undefined or currentPatch.effectSettings == null");
      return undefined;
    }

    let patch = this.currentPatch.clone();

    if (patch.effectSettings === null) {
      console.error("patch.effectSettings == null. This is a bug.");
      return undefined;
    }

    if (patch.effectSettings.length < 1) {
      console.error("patch.effectSettings.length < 1. Aborting mapping.");
      return undefined;
    }

    console.log(`*** Mapping started at ${performance.now().toFixed(1)}, using current patch ${patch.name} ***`);
    let startTime = performance.now();

    this._midi.loggingEnabled = false;

    let mappings: { [key: string]: EffectParameterMap } = {};

    let paramBuffer = new Uint8Array(7);
    let command = new Uint8Array(ZoomDevice.messageTypes.parameterValueV2.bytes.length + paramBuffer.length);
    command.set(ZoomDevice.messageTypes.parameterValueV2.bytes);
    
    let maxParamValue = 1<<13;

    let effectSlot: number = 0;
    let error = false;
    
    let counter = 1;
    let effectList: Map<number, string> = zoomEffectIDsMS50GPlus;
    let numEffects = effectList.size;
    
    for (let id of effectList.keys()) {

      // if (counter < 4) {
      //    counter++;
      //    continue;
      // }

    //   if (counter > 22 && counter < 33) {
    //     counter++;
    //     continue;
    //  }

      // if (counter > 1)
      //   break;

      if (this._cancelMapping)
        break;

      patch.effectSettings[0].id = id;
      this.uploadCurrentPatch(patch, false);

      // let verifyPatch = await this.downloadCurrentPatch();

      // if (verifyPatch === undefined || verifyPatch.effectSettings === null || verifyPatch.effectSettings.length < 1) {
      //   console.error(`Failed to download and verify current patch for effect ${counter.toString().padStart(3, "0")}, ID ${id.toString(16).toUpperCase().padStart(8, "0")}`);
      //   console.error(`verifyPatch: ${verifyPatch}, effectSettings: ${verifyPatch?.effectSettings}, effectSettings.length: ${verifyPatch?.effectSettings?.length}`);
      //   return undefined;
      // }

      // let verifyID = verifyPatch.effectSettings[0].id;
      // if (verifyID !== id) {
      //   console.warn(`Unable to set current patch to effect ${counter.toString().padStart(3, "0")}, ID ${id.toString(16).toUpperCase().padStart(8, "0")}`);
      //   console.warn(`patch.effectSettings[0].id: ${verifyID}, expected id: ${id}`);
      //   counter++;
      //   continue;
      // }

      let screenCollection = await this.downloadScreens(effectSlot, effectSlot);
      if (screenCollection === undefined) {
        console.error("*** Failed to download screens while verifying patch, aborting mapping ***");
        return undefined;
      }

      if (screenCollection.screens.length != 1) {
        console.error(`*** screenCollection.screens.length ${screenCollection.screens.length} is out of range while verifying patch, aborting mapping ***`);
        return undefined;
      }

      let screen = screenCollection.screens[0].parameters;

      if (screen[1].name.toUpperCase() !== effectList.get(id)?.toUpperCase()) {
        console.warn(`*** screen[1].name "${screen[1].name}" does not match zoomEffectIDsMS70CDRPlus.get(id) "${effectList.get(id)}" while verifying patch, skipping effect ***`);
        console.warn(`Screen: ${JSON.stringify(screen)}`);
        counter++;
        continue;
      }

      let effectSettings: EffectSettings = patch.effectSettings[0];

      console.log(`Starting mapping for effect ${counter.toString().padStart(3, "0")} / ${numEffects} "${effectList.get(id)}" (0x${id.toString(16).toUpperCase().padStart(8, "0")}) with ${effectSettings.parameters.length} parameters`);

      let mappingsForEffect: EffectParameterMap = {
        name: effectList.get(id)!,
        parameters: new Array<ParameterValueMap>()
      }; 
    
      for (let paramNumber = 2; paramNumber - 2 < effectSettings.parameters.length; paramNumber++) {

        console.log(`Mapping parameters for effect ${effectList.get(id)} (0x${id.toString(16).toUpperCase().padStart(8, "0")}), paramNumber ${(paramNumber).toString().padStart(2, " ")} of ${effectSettings.parameters.length + 2 - 1}`);
        // paramNumber = paramIndex + 2;

        let mappingsForParameterValue: ParameterValueMap | undefined;
        [mappingsForParameterValue, error] = await mapParameter(this, effectSlot, paramNumber);

        if (error) {
          console.error(`Error mapping parameter ${paramNumber} for effect ${effectList.get(id)} (0x${id.toString(16).toUpperCase().padStart(8, "0")})`);
          break;
        }

        if (mappingsForParameterValue === undefined) {
          console.log(`Got no reply for parameter ${paramNumber}. Number of parameters for effect ${effectList.get(id)} (0x${id.toString(16).toUpperCase().padStart(8, "0")}) is ${mappingsForEffect.parameters.length}`);
          break;
        }

        mappingsForEffect.parameters.push(mappingsForParameterValue);
      }
     
      if (error) {
        break;
      }

      console.log(`Mapping done for effect ${counter.toString().padStart(3, "0")} "${effectList.get(id)}" (0x${id.toString(16).toUpperCase().padStart(8, "0")}), mapped ${mappingsForEffect.parameters.length} of ${effectSettings.parameters.length - 1} parameters`);
      mappings[id.toString(16).padStart(8, "0")] =  mappingsForEffect;

      counter++;

      sleepForAWhile(100); // let the chrome console catch up ???
    }

    let timeSpent = performance.now() - startTime;
    let minutes = Math.floor(timeSpent / (1000 * 60));
    let seconds = Math.floor((timeSpent % (1000 * 60)) / 1000);

    if (error)
      console.error(`*** Mapping ended with errors after ${timeSpent/1000} seconds ******`);
    else if (this._cancelMapping) {
      this._cancelMapping = false;
      console.log(`*** Mapping cancelled at ${performance.now().toFixed(1)} after ${minutes} minutes ${seconds} seconds ***`);
    }
    else
      console.log(`*** Mapping successful at ${performance.now().toFixed(1)} after ${minutes} minutes ${seconds} seconds ***`);    

    //console.log(JSON.stringify(mappings, null, 2));

    //this.uploadCurrentPatch(originalCurrentPatch);

    this._disableMidiHandlers = false;

    return mappings;

    async function mapParameter(device: ZoomDevice, effectSlot: number, paramNumber: number): Promise<[ParameterValueMap | undefined, boolean]>
    {
      let mappingsForParameterValue: ParameterValueMap | undefined = undefined;
      let error = false;
      let log = false;
      // If the param value on the pedal is already 0, we won't get a reply when we start probing (at value 0).
      // So before we start probing, we set param value to 1, that way we should always get a reply for value 0,
      // if the paramNumber is valid.

      setParamBuffer(paramBuffer, effectSlot, paramNumber, 1);
      command.set(paramBuffer, ZoomDevice.messageTypes.parameterValueV2.bytes.length);
      let reply = await device.sendCommandAndGetReply(command, received => true);

      let paramValue: number;
      for (paramValue = 0; paramValue < maxParamValue; paramValue++) {
        setParamBuffer(paramBuffer, effectSlot, paramNumber, paramValue);
        command.set(paramBuffer, ZoomDevice.messageTypes.parameterValueV2.bytes.length);

        if (log) console.log(`Sending effect slot: ${effectSlot}, param number: ${paramNumber}, param value: ${paramValue}`);

        let reply = await device.sendCommandAndGetReply(command, received => {
          let commandMatch = device.zoomCommandMatch(received, ZoomDevice.messageTypes.parameterValueAcceptedV2.bytes);
          if (!commandMatch) {
            console.log(`Sent     effect slot: ${effectSlot}, param number: ${paramNumber}, param value: ${paramValue}`);
            console.warn("Received an unexpeced reply. Investigate.");
            return false; 
          }

          let offset = 4 + ZoomDevice.messageTypes.parameterValueAcceptedV2.bytes.length;

          let receivedEffectSlot = received[offset + 0] & 0b01111111;
          let receivedParamNumber = received[offset + 1] & 0b01111111;
          let receivedParamValue = (received[offset + 2] & 0b01111111) + ((received[offset + 3] & 0b01111111) << 7);
          if (receivedEffectSlot !== effectSlot || receivedParamNumber !== paramNumber || receivedParamValue !== paramValue) {
            if (log) console.log(`Sent     effect slot: ${effectSlot}, param number: ${paramNumber}, param value: ${paramValue}`);
            if (log) console.log(`Received effect slot: ${receivedEffectSlot}, param number: ${receivedParamNumber}, param value: ${receivedParamValue}`);
            if (log) console.log(`Reply mismatch: ${receivedEffectSlot}, ${receivedParamNumber}, ${receivedParamValue} != ${effectSlot}, ${paramNumber}, ${paramValue}`);
            if (log) console.log("Reply mismatch usually means that the parameter number is out of range (no more parameters)")
            return false;
          }

          return true;
        });
        if (reply === undefined) {
          if (log) console.log(`Sent     effect slot: ${effectSlot}, param number: ${paramNumber}, param value: ${paramValue}`);
          if (log) console.log("Timeout... Which usually means that the parameter value is out of range (no more values)");
          if (log) console.log(`Max param value for parameter ${paramNumber} is ${paramValue - 1}`);
          if (paramValue === 0)
            mappingsForParameterValue = undefined;
          break;
        }
        else {
          // request screens
          let screenCollection = await device.downloadScreens(effectSlot, effectSlot);
          if (screenCollection === undefined) {
            console.error("*** Failed to download screens, aborting mapping ***");
            error = true;
            mappingsForParameterValue = undefined;
            break;
          }

          if (screenCollection.screens.length != 1) {
            console.error(`*** screenCollection.screens.length ${screenCollection.screens.length} is out of range, aborting mapping ***`);
            error = true;
            mappingsForParameterValue = undefined;
            break;
          }

          let screen = screenCollection.screens[0];
          if (paramNumber >= screen.parameters.length) {
            console.warn(`Warning: paramNumber (${paramNumber}) >= screen.parameters.length (${screen.parameters.length}), using (patch) paramValue as textValue. Investigate.`);
            console.warn(`           Unknown = ${paramValue} -> "${paramValue.toString()}"`);
            if (mappingsForParameterValue === undefined)
              mappingsForParameterValue = { name: "Unknown", values: new Array<string>(), max: 0 };
            mappingsForParameterValue.values.push(paramValue.toString());
            continue;
          }

          let parameter = screen.parameters[paramNumber];
          // Map Zoom's byte codes to HTML/unicode characters. This is also done in htmltools.ts
          // let valueString = parameter.valueString.replace(/\x16/g, "&#119138;").replace(/\x17/g, "&#119137;").replace(/\x18/g, "&#119136;").replace(/\x19/g, "&#119135;").replace(/\x1A/g, "&#119134;");
          let valueString = ZoomPatch.noteByteCodeToHtml(parameter.valueString);

          if (log) console.log(`           ${parameter.name} = ${paramValue} -> "${valueString}"`);
          if (mappingsForParameterValue === undefined)
            mappingsForParameterValue = { name: parameter.name, values: new Array<string>(), max: 0 };
          mappingsForParameterValue.values.push(valueString);
          if (log) console.log(`  Control: ${mappingsForParameterValue.name} = ${paramValue} -> "${mappingsForParameterValue.values[paramValue]}"`);
        }
      }
      if (mappingsForParameterValue !== undefined) 
        mappingsForParameterValue.max = paramValue - 1
      return [mappingsForParameterValue, error];
    }

    function setParamBuffer(paramBuffer: Uint8Array, effectSlot: number, paramNumber: number, paramValue: number) {
      paramBuffer[0] = effectSlot & 0b01111111;
      paramBuffer[1] = paramNumber & 0b01111111;
      paramBuffer[2] = paramValue & 0b01111111;
      paramBuffer[3] = (paramValue >> 7) & 0b01111111;
      paramBuffer[4] = 0;
      paramBuffer[5] = 0;
      paramBuffer[6] = 0;
    }
  }
}

enum SupportType
{
  Unsupported = 0,
  Supported = 1,
  Unknown = 2,
}
