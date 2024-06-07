import { ZoomPatch } from "./ZoomPatch.js";
import { IMIDIProxy } from "./midiproxy.js";
import { MIDIDeviceDescription } from "./miditools.js";
import { crc32, eight2seven, getExceptionErrorString, partialArrayMatch, seven2eight, toHexString, toUint8Array } from "./tools.js";

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

export class ZoomDevice
{
  private _midiDevice: MIDIDeviceDescription;
  private _timeoutMilliseconds: number;
  private _midi: IMIDIProxy;
  private _isOldDevice: boolean = true; // FIXME: to be replaced with a more granular approach, perhaps mapping out automatically what commands are supported.
  private _zoomDeviceId: number;
  private _zoomDeviceIdString: string;
  private _commandBuffers: Map<number, Uint8Array> = new Map<number, Uint8Array>();
  private _listeners: ZoomDeviceListenerType[] = new Array<ZoomDeviceListenerType>();
  private _commands: ZoomMessageTypes = new ZoomMessageTypes();

  private _numPatches: number = -1;
  private _patchLength: number = -1;
  private _patchesPerBank: number = -1;

  public loggingEnabled: boolean = true;

  constructor(midi: IMIDIProxy, midiDevice: MIDIDeviceDescription, timeoutMilliseconds: number = 100)
  {
    this._midiDevice = midiDevice;
    this._timeoutMilliseconds = timeoutMilliseconds;
    this._midi = midi;
    this._zoomDeviceId = this._midiDevice.familyCode[0];
    this._zoomDeviceIdString = this._zoomDeviceId.toString(16).padStart(2, "0");

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
    this.sendCommand(this._commands.parameterEditEnable.bytes);
  }

  public parameterEditDisable() 
  {
    this.sendCommand(this._commands.parameterEditDisable.bytes);
  }

  public pcModeEnable() 
  {
    this.sendCommand(this._commands.pcModeEnable.bytes
    );
  }

  public pcModeDisable() 
  {
    this.sendCommand(this._commands.pcModeEnable.bytes);
  }

  public async getCurrentBankAndProgram() : Promise<ZoomBankProgram> 
  {
    return new ZoomBankProgram();
  }

  public setCurrentBankAndProgram(bank: number, program: number)
  {

  }

  public async downloadCurrentPatch() : Promise<Uint8Array | undefined>
  {
    let reply: Uint8Array | undefined;
    if (this._supportedCommands.get(this._commands.requestCurrentPatchV2.str) === SupportType.Supported) {
      reply = await this.sendCommandAndGetReply(this._commands.requestCurrentPatchV2.bytes, 
        received => this.zoomCommandMatch(received, this._commands.patchDumpForCurrentPatchV2.bytes));
    }
    else { 
      reply = await this.sendCommandAndGetReply(this._commands.requestCurrentPatchV1.bytes, 
        received => this.zoomCommandMatch(received, this._commands.patchDumpForCurrentPatchV1.bytes));
    }
    return reply;
  }

  public requestCurrentPatch() 
  {
    if (this._supportedCommands.get(this._commands.requestCurrentPatchV2.str) === SupportType.Supported)
      this.sendCommand(this._commands.requestCurrentPatchV2.bytes);
    else 
      this.sendCommand(this._commands.requestCurrentPatchV1.bytes);
  }

  public async downloadPatchFromMemorySlot(memorySlot: number) : Promise<ZoomPatch | undefined>
  {
    let reply: Uint8Array | undefined;
    let eightBitData: Uint8Array | undefined = undefined;

    if (this._supportedCommands.get(this._commands.requestPatchDumpForMemoryLocationV2.str) === SupportType.Supported) {
      let bank = Math.floor(memorySlot / this._patchesPerBank);
      let program = memorySlot % this._patchesPerBank;
      let bankProgram = new Uint8Array(4);
      bankProgram[0] = bank & 0x7F;
      bankProgram[1] = (bank >> 7) & 0x7F;
      bankProgram[2] = program & 0x7F;
      bankProgram[3] = (program >> 7) & 0x7F;
      let command = new Uint8Array(this._commands.requestPatchDumpForMemoryLocationV2.bytes.length + bankProgram.length);
      command.set(this._commands.requestPatchDumpForMemoryLocationV2.bytes);
      command.set(bankProgram, this._commands.requestPatchDumpForMemoryLocationV2.bytes.length);
       
      reply = await this.sendCommandAndGetReply(command, 
        received => this.zoomCommandMatch(received, this._commands.patchDumpForMemoryLocationV2.bytes));
      if (reply !== undefined) {
        let offset = 13;
        eightBitData = seven2eight(reply, offset, reply.length-2);
      }
    }
    // FIXME: Implement v1 as well
    // else { 
    //   reply = await this.sendCommandAndGetReply(this._commands.requestCurrentPatchV1.bytes, 
    //     received => this.zoomCommandMatch(received, this._commands.patchDumpForCurrentPatchV1.bytes));
    // }
    if (eightBitData != undefined) {
      let patch = ZoomPatch.fromPatchData(eightBitData);
      return patch;
    }
    else
      return undefined;
  }

  public uploadCurrentPatch(data: Uint8Array) 
  {
    let paddedData = data;
    if (this._patchLength != -1) {
      if (data.length > paddedData.length) {
        console.error(`The length of the supplied patch data (${data.length} is greater than the patch length reported by the pedal (${this._patchLength}).`);
      }
      paddedData = new Uint8Array(this._patchLength);
      paddedData.set(data);
    }
    let sevenBitData = eight2seven(paddedData);
    this.sendCommand(sevenBitData, this._commands.uploadCurrentPatchV1.bytes);
  }

  /**
   * 
   * @param data 
   * @param memorySlot Zero-based memory location. Typically between 0-49 or 0-99 depending on pedal. 
   */
  public uploadPatchToMemorySlot(data: Uint8Array, memorySlot: number) 
  {
    let paddedData = data;
    if (this._patchLength != -1) {
      if (data.length > paddedData.length) {
        console.error(`The length of the supplied patch data (${data.length} is greater than the patch length reported by the pedal (${this._patchLength}).`);
      }
      paddedData = new Uint8Array(this._patchLength);
      paddedData.set(data);
    }
    let sevenBitData = eight2seven(paddedData);
    
    let crc = crc32(paddedData, 0, paddedData.length - 1);
    crc = crc  ^ 0xFFFFFFFF;
    let crcBytes = new Uint8Array([crc & 0x7F, (crc >> 7) & 0x7F, (crc >> 14) & 0x7F, (crc >> 21) & 0x7F, (crc >> 28) & 0x0F]);

    let command = new Uint8Array(this._commands.patchDumpForMemoryLocationV2.bytes.length + 6);
    command.set(this._commands.patchDumpForMemoryLocationV2.bytes);

    let bank = Math.floor(memorySlot / this._patchesPerBank);
    let program = memorySlot %this._patchesPerBank;
    let length = paddedData.length;
    let bankProgramLength = new Uint8Array(6);
    bankProgramLength[0] = bank & 0x7F;
    bankProgramLength[1] = (bank >> 7) & 0x7F;
    bankProgramLength[2] = program & 0x7F;
    bankProgramLength[3] = (program >> 7) & 0x7F;
    bankProgramLength[4] = length & 0x7F;
    bankProgramLength[5] = (length >> 7) & 0x7F;
    command.set(bankProgramLength, this._commands.patchDumpForMemoryLocationV2.bytes.length);

    this.sendCommand(sevenBitData, command, crcBytes);
  }


  private isCommandSupported(command: StringAndBytes): boolean
  {
    return this._supportedCommands.get(command.str) === SupportType.Supported;
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
      commandBuffer[3] = this._zoomDeviceId;
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

  private getCommandBufferFromData(data: Uint8Array, prependCommand: Uint8Array | null = null, appendCRC: Uint8Array | null = null) : Uint8Array
  {
    let prependCommandLength = (prependCommand !== null) ? prependCommand.length : 0; 
    let appendCRCLength = (appendCRC !== null) ? appendCRC.length : 0; 
    let commandLength = 5 + data.length + prependCommandLength + appendCRCLength;
    let commandBuffer = this._commandBuffers.get(commandLength);
    if (commandBuffer === undefined) {
      commandBuffer = new Uint8Array(commandLength);
      commandBuffer[0] = 0xF0;
      commandBuffer[1] = 0x52;
      commandBuffer[3] = this._zoomDeviceId;
      commandBuffer[commandBuffer.length - 1] = 0xF7;
      this._commandBuffers.set(commandLength, commandBuffer);
    }

    if (prependCommand !== null)
      commandBuffer.set(prependCommand, 4);
    commandBuffer.set(data, 4 + prependCommandLength);
    if (appendCRC !== null)
      commandBuffer.set(appendCRC, 4 + prependCommandLength + data.length);
    return commandBuffer;
  }

  private async sendCommandAndGetReply(data: Uint8Array, verifyReply: (data: Uint8Array) => boolean, timeoutMilliseconds: number = this._timeoutMilliseconds) : Promise<Uint8Array | undefined>
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

    let commandBuffer = this.getCommandBufferFromData(data);
  
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
    return data.length >= 4 + command.length && data[0] == 0xF0 && data[data.length-1] == 0xF7 && data[1] == 0x52 && data[2] == 0 && data[3] == this._zoomDeviceId && 
      data.slice(4, 4 + command.length).every( (element, index) => element === command[index] );
  }
  

  private connectMessageHandler() 
  {
    this._midi.addListener(this._midiDevice.inputID, (deviceHandle, data) => {
      console.log(`Received: ${toHexString(data, " ")}`);
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


  _supportedCommands: Map<string, SupportType> = new Map<string, SupportType>();

  private async probeCommand(command: string, parameters: string, expectedReply: string, probeTimeoutMilliseconds: number) : Promise<Uint8Array | undefined>
  {
    let reply: Uint8Array | undefined;
    if (parameters.length > 0)
      parameters = " " + parameters
    reply = await this.sendCommandAndGetReply(toUint8Array(command + parameters), (received) => 
      partialArrayMatch(received, toUint8Array(`F0 52 00 ${this._zoomDeviceIdString} ${expectedReply}`)), probeTimeoutMilliseconds);
    this._supportedCommands.set(command, reply !== undefined ? SupportType.Supported : SupportType.Unknown);
    return reply;
  }

  private async probeDevice() 
  {
    let probeTimeoutMilliseconds = 300;

    let command: string;
    let expectedReply: string;
    let reply: Uint8Array | undefined;

    command =this._commands.requestCurrentPatchV1.str;
    expectedReply = this._commands.patchDumpForCurrentPatchV1.str;
    reply = await this.probeCommand(command, "", expectedReply, probeTimeoutMilliseconds);

    command =this._commands.requestCurrentPatchV2.str;
    expectedReply = this._commands.patchDumpForCurrentPatchV2.str;
    reply = await this.probeCommand(command, "", expectedReply, probeTimeoutMilliseconds);

    command =this._commands.requestBankAndPatchInfoV2.str;
    expectedReply = this._commands.bankAndPatchInfoV2.str;
    reply = await this.probeCommand(command, "", expectedReply, probeTimeoutMilliseconds);
    if (reply !== undefined && reply.length > 13) {
      this._numPatches = reply[5] + (reply[6] << 7);
      this._patchLength = reply[7] + (reply[8] << 7);
      let unknown = reply[9] + (reply[10] << 7);
      this._patchesPerBank = reply[11] + (reply[12] << 7);
    }

    command = this._commands.requestPatchDumpForMemoryLocationV2.str; 
    expectedReply = this._commands.patchDumpForMemoryLocationV2.str + " 00 00 00 00"; // bank 0, program 0
    reply = await this.probeCommand(command, "00 00 00 00", expectedReply, probeTimeoutMilliseconds);
  }
}

class StringAndBytes
{
  readonly str: string;
  readonly bytes: Uint8Array;

  constructor(str: string)
  {
    this.str = str;
    this.bytes = toUint8Array(str);
  }
}

class ZoomMessageTypes
{
  uploadCurrentPatchV1 =  new StringAndBytes("28");
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

enum SupportType
{
  Unsupported = 0,
  Supported = 1,
  Unknown = 2,
}
