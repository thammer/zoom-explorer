import { ZoomPatch } from "./ZoomPatch.js";
import { IMIDIProxy } from "./midiproxy.js";
import { MIDIDeviceDescription } from "./miditools.js";
import { crc32, eight2seven, getExceptionErrorString, getNumberOfEightBitBytes, partialArrayMatch, partialArrayStringMatch, seven2eight, bytesToHexString, hexStringToUint8Array } from "./tools.js";

export class ZoomBankProgram
{
  public bank: number;
  public program: number;

  constructor(bank: number = 0, program: number = 0)
  {
    this.bank = bank; 
    this.program = program;
  }
}

export type ZoomDeviceListenerType = (zoomDevice: ZoomDevice, data: Uint8Array) => void;

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
  bankAndPatchInfoV2 =  new StringAndBytes("43");
  requestBankAndPatchInfoV2 =  new StringAndBytes("44");
  patchDumpForMemoryLocationV2 =  new StringAndBytes("45 00 00");
  requestPatchDumpForMemoryLocationV2 = new StringAndBytes("46 00 00");
  parameterEditEnable = new StringAndBytes("50");
  parameterEditDisable = new StringAndBytes("51");
  pcModeEnable = new StringAndBytes("52");
  pcModeDisable = new StringAndBytes("53");
  patchDumpForCurrentPatchV2 = new StringAndBytes("64 12");
  requestCurrentPatchV2 = new StringAndBytes("64 13");
}

export class ZoomDevice
{
  private _midiDevice: MIDIDeviceDescription;
  private _timeoutMilliseconds: number;
  private _midi: IMIDIProxy;
  private _isOldDevice: boolean = true; // FIXME: to be replaced with a more granular approach, perhaps mapping out automatically what commands are supported.
  private _zoomDeviceID: number;
  private _zoomDeviceIdString: string;
  private _commandBuffers: Map<number, Uint8Array> = new Map<number, Uint8Array>();
  private _listeners: ZoomDeviceListenerType[] = new Array<ZoomDeviceListenerType>();
  private static messageTypes: ZoomMessageTypes = new ZoomMessageTypes();
  private _supportedCommands: Map<string, SupportType> = new Map<string, SupportType>();

  private _numPatches: number = -1;
  private _patchLength: number = -1;
  private _patchesPerBank: number = -1;
  private _patchDumpForMemoryLocationV1CRCBytes: number = 0;
  private _ptcfPatchFormatSupported: boolean = false;

  public loggingEnabled: boolean = true;

  constructor(midi: IMIDIProxy, midiDevice: MIDIDeviceDescription, timeoutMilliseconds: number = 200)
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

  public get deviceInfo() : MIDIDeviceDescription
  {
    return this._midiDevice;
  }

  public async open()
  {
    await this._midi.openInput(this._midiDevice.inputID);
    await this._midi.openOutput(this._midiDevice.outputID);
    this.connectMessageHandler();
    await this.probeDevice();
  }

  public async close()
  {
    // FIXME: Disconnect handlers here
    this.disconnectMessageHandler();
  }

  public addListener(listener: ZoomDeviceListenerType): void
  {
    this._listeners.push(listener);
  }

  public removeListener(listener: ZoomDeviceListenerType): void
  {
    this._listeners = this._listeners.filter( (l) => l !== listener);
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

  public async getCurrentBankAndProgram() : Promise<ZoomBankProgram> 
  {
    return new ZoomBankProgram();
  }

  public setCurrentBankAndProgram(bank: number, program: number)
  {

  }

  public async downloadCurrentPatch() : Promise<ZoomPatch | undefined>
  {
    let reply: Uint8Array | undefined;
    let eightBitData: Uint8Array | undefined = undefined;

    if (this._supportedCommands.get(ZoomDevice.messageTypes.requestCurrentPatchV2.str) === SupportType.Supported) {
      reply = await this.sendCommandAndGetReply(ZoomDevice.messageTypes.requestCurrentPatchV2.bytes, 
        received => this.zoomCommandMatch(received, ZoomDevice.messageTypes.patchDumpForCurrentPatchV2.bytes));
      if (reply !== undefined) {
        let offset = 13;
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
      let patch = ZoomPatch.fromPatchData(eightBitData);
      return patch;
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

  public uploadCurrentPatch(patch: ZoomPatch) 
  {
    if (patch.ptcfChunk === null || patch.ptcfChunk.length < 11) {
      console.error(`ZoomDevice.uploadCurrentPatch() received Invalid patch parameter`);
      return;
    }
    let data = patch.ptcfChunk;
    let paddedData = data;
    if (this._patchLength != -1) {
      if (data.length > paddedData.length) {
        console.error(`The length of the supplied patch data (${data.length} is greater than the patch length reported by the pedal (${this._patchLength}).`);
      }
      paddedData = new Uint8Array(this._patchLength);
      paddedData.set(data);
    }
    let sevenBitData = eight2seven(paddedData);
    this.sendCommand(sevenBitData, ZoomDevice.messageTypes.patchDumpForCurrentPatchV1.bytes);
  }

  /**
   * 
   * @param data 
   * @param memorySlot Zero-based memory location. Typically between 0-49 or 0-99 depending on pedal. 
   */
  public async uploadPatchToMemorySlot(patch: ZoomPatch, memorySlot: number, waitForAcknowledge: boolean = true) 
  {
    let sevenBitData: Uint8Array;
    let crcBytes: Uint8Array;
    let command: Uint8Array;

    if (patch.ptcfChunk !== null) {
      let data = patch.ptcfChunk;
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
      let data = patch.msogDataBuffer;
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
  }

  public getSysexForCurrentPatch(patch: ZoomPatch): Uint8Array | undefined
  {
    if (patch.msogDataBuffer !== null && this.isCommandSupported(ZoomDevice.messageTypes.requestCurrentPatchV1)) {
      let sevenBitData = eight2seven(patch.msogDataBuffer);
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

  private isCommandSupported(command: StringAndBytes): boolean
  {
    return this._supportedCommands.get(command.str) === SupportType.Supported;
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
   * Builds a complete sysex message from several parts, with default caching of buffers. Caching should only be used if the result of this function is used immediately, e.g. being sent in a command.
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
      if (this.loggingEnabled) 
        console.log(`Received: ${bytesToHexString(data, " ")}`);
      this.handleMIDIDataFromZoom(data);
    });
  }

  private handleMIDIDataFromZoom(data: Uint8Array): void
  {
    for (let listener of this._listeners)
      listener(this, data);
  }

  private disconnectMessageHandler() {
    throw new Error("Method not implemented.");
  }

  private async probeCommand(command: string, parameters: string, expectedReply: string, probeTimeoutMilliseconds: number) : Promise<Uint8Array | undefined>
  {
    let reply: Uint8Array | undefined;
    if (parameters.length > 0)
      parameters = " " + parameters
    reply = await this.sendCommandAndGetReply(hexStringToUint8Array(command + parameters), (received) => 
      partialArrayMatch(received, hexStringToUint8Array(`F0 52 00 ${this._zoomDeviceIdString} ${expectedReply}`)), null, null, probeTimeoutMilliseconds);
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

    if (this.isCommandSupported(ZoomDevice.messageTypes.requestPatchDumpForMemoryLocationV1) && !this.isCommandSupported(ZoomDevice.messageTypes.requestCurrentPatchV1) && !this._ptcfPatchFormatSupported) {
      console.warn("Device supports requesting patch for memory location (v1) but not requesting current patch (v1).");
      console.warn("And the device does not support the PTCF format, so it's probably a MS v1 device");
      console.warn("But then it's probably incorrect that it doesn't support requesting current patch (v1), so we'll probe for requesting current patch once more.");
      command =ZoomDevice.messageTypes.requestCurrentPatchV1.str;
      expectedReply = ZoomDevice.messageTypes.patchDumpForCurrentPatchV1.str;
      reply = await this.probeCommand(command, "", expectedReply, probeTimeoutMilliseconds);
      if (reply === undefined) {
        console.warn("Probing for request patch (v1) failed the second time as well.");
        console.warn("Probing one final time, with parameter edit enabled.");
        this.parameterEditEnable();

        command =ZoomDevice.messageTypes.requestCurrentPatchV1.str;
        expectedReply = ZoomDevice.messageTypes.patchDumpForCurrentPatchV1.str;
        reply = await this.probeCommand(command, "", expectedReply, probeTimeoutMilliseconds);
        if (reply === undefined)
          console.warn("Probing for request patch (v1) failed the third time as well.");
        else
          console.log("Probing for request patch (v1) succeeded on third attempt. Weird.")

        this.parameterEditDisable();
      }
      else
        console.log("Probing for request patch (v1) succeeded on second attempt. Weird.")
    }

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

    }

    if (this.loggingEnabled)
      console.log(`Probing ended for device ${this.deviceInfo.deviceName}`);
  }
}

enum SupportType
{
  Unsupported = 0,
  Supported = 1,
  Unknown = 2,
}
