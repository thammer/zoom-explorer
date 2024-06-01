import { IMIDIProxy } from "./midiproxy.js";
import { MIDIDeviceDescription } from "./miditools.js";
import { getExceptionErrorString, partialArrayMatch, toHexString, toUint8Array } from "./tools.js";

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

  public async getCurrentPatch() : Promise<Uint8Array | undefined>
  {
    let reply: Uint8Array | undefined;
    if (this._supportedCommands.get(this._commands.requestCurrentPatchV2.str) === SupportType.Supported) {
      reply = await this.sendCommandAndGetReply(this._commands.requestCurrentPatchV2.bytes, 
        received => this.zoomCommandMatch(received, this._commands.patchDumpV2.bytes));
    }
    else { 
      reply = await this.sendCommandAndGetReply(this._commands.requestCurrentPatchV1.bytes, 
        received => this.zoomCommandMatch(received, this._commands.patchDumpV1.bytes));
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

  private sendCommand(data: Uint8Array) : void
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
      this._midi.send(this._midiDevice.outputID, commandBuffer);
    }
    catch (err) 
    {
      let message = getExceptionErrorString(err, `for device ${output.name}`);
      console.error(message);
    }
  }

  private getCommandBufferFromData(data: Uint8Array) : Uint8Array
  {
    let commandLength = 5 + data.length;
    let commandBuffer = this._commandBuffers.get(commandLength);
    if (commandBuffer === undefined) {
      commandBuffer = new Uint8Array(commandLength);
      commandBuffer[0] = 0xF0;
      commandBuffer[1] = 0x52;
      commandBuffer[3] = this._zoomDeviceId;
      commandBuffer[commandBuffer.length - 1] = 0xF7;
      this._commandBuffers.set(commandLength, commandBuffer);
    }

    commandBuffer.set(data, 4);
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

  private async probeDevice() 
  {
    let probeTimeoutMilliseconds = 300;

    let command: string;
    let expectedReply: string;
    let reply: Uint8Array | undefined;

    command =this._commands.requestCurrentPatchV1.str;
    expectedReply = this._commands.patchDumpV1.str;
    reply = await this.sendCommandAndGetReply(toUint8Array(command), (received) => 
      partialArrayMatch(received, toUint8Array(`F0 52 00 ${this._zoomDeviceIdString} ${expectedReply}`)), probeTimeoutMilliseconds);
    this._supportedCommands.set(command, reply !== undefined ? SupportType.Supported : SupportType.Unknown);

    command =this._commands.requestCurrentPatchV2.str;
    expectedReply = this._commands.patchDumpV2.str;
    reply = await this.sendCommandAndGetReply(toUint8Array(command), (received) => 
      partialArrayMatch(received, toUint8Array(`F0 52 00 ${this._zoomDeviceIdString} ${expectedReply}`)), probeTimeoutMilliseconds);
    this._supportedCommands.set(command, reply !== undefined ? SupportType.Supported : SupportType.Unknown);
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
  parameterEditEnable = new StringAndBytes("50");
  parameterEditDisable = new StringAndBytes("51");
  pcModeEnable = new StringAndBytes("52");
  pcModeDisable = new StringAndBytes("53");
  patchDumpV1 = new StringAndBytes("28");
  requestCurrentPatchV1 = new StringAndBytes("29");
  patchDumpV2 = new StringAndBytes("64 12");
  requestCurrentPatchV2 = new StringAndBytes("64 13");
}

enum SupportType
{
  Unsupported = 0,
  Supported = 1,
  Unknown = 2,
}
