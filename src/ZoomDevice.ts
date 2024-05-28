import { IMIDIProxy } from "./midiproxy.js";
import { MIDIDeviceDescription } from "./miditools.js";
import { getExceptionErrorString, toUint8Array } from "./tools.js";

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

const parameterEditEnableCommand = toUint8Array("50");
const parameterEditDisableCommand = toUint8Array("51");
const pcModeEnableCommand = toUint8Array("52");
const pcModeDisableCommand = toUint8Array("53");

export class ZoomDevice
{
  private midiDevice: MIDIDeviceDescription;
  private timeoutMilliseconds: number;
  private midi: IMIDIProxy;
  private isOldDevice: boolean = true; // FIXME: to be replaced with a more granular approach, perhaps mapping out automatically what commands are supported.
  private zoomDeviceId: number;
  private commandBuffers: Map<number, Uint8Array> = new Map<number, Uint8Array>();

  public loggingEnabled: boolean = true;

  constructor(midi: IMIDIProxy, midiDevice: MIDIDeviceDescription, timeoutMilliseconds: number = 100)
  {
    this.midiDevice = midiDevice;
    this.timeoutMilliseconds = timeoutMilliseconds;
    this.midi = midi;
    this.zoomDeviceId = this.midiDevice.familyCode[0];

    for (let i=6; i<15; i++)
      this.commandBuffers.set(i, toUint8Array(`F0 52 00 ${this.zoomDeviceId} ${"00".repeat(i-5)} F7`))
  }

  private setDeviceType()
  {

  }

  private sendZoomCommandNumbers(...data: number[]) : void
  {
    let commandLength = 5 + data.length;
    let output = this.midi.getOutputInfo(this.midiDevice.outputID);
    if (output === undefined)
    {
      console.warn(`WARNING: Not sending MIDI message to device ${this.midiDevice.outputID} as the device is unknown"`);
      return;
    }
    if (output.connection != "open")
    {
      console.warn(`WARNING: Not sending MIDI message to device ${output.name} as the port is in state "${output.connection}"`);
      return;
    }

    let commandBuffer = this.commandBuffers.get(commandLength);
    if (commandBuffer === undefined) {
      commandBuffer = new Uint8Array(commandLength);
      commandBuffer[0] = 0xF0; 
      commandBuffer[1] = 0x52; 
      commandBuffer[3] = this.zoomDeviceId;
      commandBuffer[commandBuffer.length - 1] = 0xF7; 
      this.commandBuffers.set(commandLength, commandBuffer)
    }

    commandBuffer.set(data, 4);
  
    try 
    {
      this.midi.send(this.midiDevice.outputID, commandBuffer);
    }
    catch (err) 
    {
      let message = getExceptionErrorString(err, `for device ${output.name}`);
      console.error(message);
    }
  }

  private sendZoomCommand(data: Uint8Array) : void
  {
    let commandLength = 5 + data.length;
    let output = this.midi.getOutputInfo(this.midiDevice.outputID);
    if (output === undefined)
    {
      console.warn(`WARNING: Not sending MIDI message to device ${this.midiDevice.outputID} as the device is unknown"`);
      return;
    }
    if (output.connection != "open")
    {
      console.warn(`WARNING: Not sending MIDI message to device ${output.name} as the port is in state "${output.connection}"`);
      return;
    }

    let commandBuffer = this.commandBuffers.get(commandLength);
    if (commandBuffer === undefined) {
      commandBuffer = new Uint8Array(commandLength);
      commandBuffer[0] = 0xF0; 
      commandBuffer[1] = 0x52; 
      commandBuffer[3] = this.zoomDeviceId;
      commandBuffer[commandBuffer.length - 1] = 0xF7; 
      this.commandBuffers.set(commandLength, commandBuffer)
    }

    commandBuffer.set(data, 4);
  
    try 
    {
      this.midi.send(this.midiDevice.outputID, commandBuffer);
    }
    catch (err) 
    {
      let message = getExceptionErrorString(err, `for device ${output.name}`);
      console.error(message);
    }
  }

  public parameterEditEnable() 
  {
    this.sendZoomCommand(parameterEditEnableCommand);
  }

  public parameterEditDisable() 
  {
    this.sendZoomCommand(parameterEditDisableCommand);
  }

  public pcModeEnable() 
  {
    this.sendZoomCommand(pcModeEnableCommand);
  }

  public pcModeDisable() 
  {
    this.sendZoomCommand(pcModeEnableCommand);
  }

  public async getCurrentBankAndProgram() : Promise<ZoomBankProgram> 
  {
    return new ZoomBankProgram();
  }

  public setCurrentBankAndProgram(bank: number, program: number)
  {

  }

}