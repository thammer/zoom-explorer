
/**
 * Module MIDIProxy provides the MIDIProxy class
 * @module MIDIProxy
 */

import { shouldLog, LogLevel } from "./Logger.js";

export type DeviceID = string;

export const ALL_MIDI_DEVICES = "ALL_MIDI_DEVICES";

export type DeviceState = "connected" | "disconnected" | "unknown";

export type DeviceInfo = 
{
  id: string,
  name: string,
  state: DeviceState,
  connection: "open" | "closed" | "pending" | "unknown";
}

export type ListenerType = (deviceHandle: DeviceID, data: Uint8Array, timeStamp: number) => void;
export type PortType = "input" | "output";

export type ConnectionListenerType = (deviceHandle: DeviceID, portType: PortType, state: DeviceState) => void;

/**
 * MIDI status bitmask for message types
 * @see https://midi.org/summary-of-midi-1-0-messages
 */
export enum MessageType {
  Unknown =     0b00000000,
  NoteOff =     0b10000000,
  NoteOn =      0b10010000,
  KeyPress =    0b10100000,
  CC =          0b10110000,
  PC =          0b11000000,
  ChanPress =   0b11010000,
  PitchBend =   0b11100000,
  SysEx =       0b11110000,
  TimeCode =    0b11110001,
  SongPos =     0b11110010,
  SongSelect =  0b11110011,
  Undefined1 =  0b11110100,
  Undefined2 =  0b11110101,
  TuneRequest = 0b11110110,
  SysExEnd =    0b11110111,
  Clock =       0b11111000,
  Undefined3 =  0b11111001,
  Start =       0b11111010,
  Continue =    0b11111011,
  Stop =        0b11111100,
  Undefined4 =  0b11111101,
  ActiveSense = 0b11111110,
  Reset       = 0b11111111
}

export interface IMIDIProxy 
{
  readonly inputs: Map<DeviceID, DeviceInfo>; 
  readonly outputs: Map<DeviceID, DeviceInfo>;
  get enabled(): boolean; 

  enable() : Promise<boolean>;

  isOutputConnected(id: DeviceID) : boolean;
  isInputConnected(id: DeviceID) : boolean;
  isDeviceConnected(id: DeviceID, type: PortType) : boolean;

  openInput(id: DeviceID) : Promise<DeviceID>;
  closeInput(deviceHandle: DeviceID) : Promise<DeviceID>;
  closeAllInputs() : Promise<void>;
  getInputInfo(id: DeviceID) : DeviceInfo;

  openOutput(id: DeviceID) : Promise<DeviceID>;
  closeOutput(deviceHandle: DeviceID) : Promise<DeviceID>;
  closeAllOutputs() : Promise<void>;
  getOutputInfo(id: DeviceID) : DeviceInfo;

  getDeviceInfo(id: DeviceID, type: PortType) : DeviceInfo;

  send(deviceHandle: DeviceID, data: number[] | Uint8Array) : void;
  sendPC(deviceHandle: DeviceID, channel: number, program: number) : void;
  sendCC(deviceHandle: DeviceID, channel: number, ccNumber: number, ccValue: number) : void;
  sendAndGetReply(outputDevice: DeviceID, data: number[] | Uint8Array, intputDevice: DeviceID, verifyReply: (data: Uint8Array) => boolean, timeoutMilliseconds: number) : Promise<Uint8Array | undefined>;

  addListener(deviceHandle: DeviceID, listener: ListenerType): void;
  removeListener(deviceHandle: DeviceID, listener: ListenerType): void;

  addConnectionListener(listener: ConnectionListenerType): void;
  removeConnectionListener(listener: ConnectionListenerType): void;

  setMuteState(deviceHandle: DeviceID, messageType: MessageType, mute: boolean): void;
  getMuteStates(deviceHandle: DeviceID): Map<MessageType, boolean> | undefined;
}

/**
 * Implements some common convenience methods for classes that implement IMIDIProxy 
 */
export abstract class MIDIProxy implements IMIDIProxy
{
  protected messageBuffer2: Uint8Array;
  protected messageBuffer3: Uint8Array;

  protected messageMutes: Map<DeviceID, Map<MessageType, boolean>>;

  constructor()
  {
    this.messageBuffer2 = new Uint8Array([0, 0]); 
    this.messageBuffer3 = new Uint8Array([0, 0, 0]); 
    this.messageMutes = new Map<DeviceID, Map<MessageType, boolean>>();
  }

  abstract readonly inputs: Map<DeviceID, DeviceInfo>; 
  abstract readonly outputs: Map<DeviceID, DeviceInfo>; 
  abstract enable() : Promise<boolean>;

  abstract isOutputConnected(id: DeviceID) : boolean;
  abstract isInputConnected(id: DeviceID) : boolean;

  abstract openInput(id: DeviceID) : Promise<DeviceID>;
  abstract closeInput(deviceHandle: DeviceID) : Promise<DeviceID>;
  abstract closeAllInputs() : Promise<void>;
  abstract getInputInfo(id: DeviceID) : DeviceInfo;

  abstract openOutput(id: DeviceID) : Promise<DeviceID>;
  abstract closeOutput(deviceHandle: DeviceID) : Promise<DeviceID>;
  abstract closeAllOutputs() : Promise<void>;
  abstract getOutputInfo(id: DeviceID) : DeviceInfo;

  abstract send(deviceHandle: DeviceID, data: number[] | Uint8Array) : void;

  abstract addListener(deviceHandle: DeviceID, listener: ListenerType): void;
  abstract removeListener(deviceHandle: DeviceID, listener: ListenerType): void;

  abstract addConnectionListener(listener: ConnectionListenerType): void;
  abstract removeConnectionListener(listener: ConnectionListenerType): void;

  protected _enabled: boolean = false;
  protected set enabled(enabled)
  {
    this._enabled = enabled;
  }
  public get enabled(): boolean
  {
    return this._enabled;       
  }

  public isDeviceConnected(id: DeviceID, type: PortType) : boolean
  {
    return type === "input" ? this.isInputConnected(id) : this.isOutputConnected(id);
  }

  public getDeviceInfo(id: DeviceID, type: PortType) : DeviceInfo
  {
    return type === "input" ? this.getInputInfo(id) : this.getOutputInfo(id);
  }

  public sendPC(deviceHandle: DeviceID, channel: number, program: number) : void
  {
    this.messageBuffer2[0] = MessageType.PC + (channel & 0b00001111);
    this.messageBuffer2[1] = program & 0b01111111;
    this.send(deviceHandle, this.messageBuffer2);
  }

  public sendCC(deviceHandle: DeviceID, channel: number, ccNumber: number, ccValue: number) : void
  {
    this.messageBuffer3[0] = MessageType.CC + (channel & 0b00001111);
    this.messageBuffer3[1] = ccNumber & 0b01111111;
    this.messageBuffer3[2] = ccValue & 0b01111111;
    this.send(deviceHandle, this.messageBuffer3);
  }

  public sendAndGetReply(outputDevice: DeviceID, data: number[] | Uint8Array, inputDevice: DeviceID, verifyReply: (data: Uint8Array) => boolean, 
                         timeoutMilliseconds: number = 100) : Promise<Uint8Array | undefined>
  {
    return new Promise<Uint8Array | undefined> ( (resolve, reject) => {
      let timeoutId = setTimeout( () => {
        shouldLog(LogLevel.Midi) && console.log(`sendAndGetReply() Timed out (${timeoutId}) for output device "${outputDevice}", input device "${inputDevice}"`);
        this.removeListener(inputDevice, handleReply);
        resolve(undefined);
      }, timeoutMilliseconds);
      let handleReply = (deviceHandle: DeviceID, data: Uint8Array) => {
        if (verifyReply(data)) {
          clearTimeout(timeoutId);
          this.removeListener(deviceHandle, handleReply);
          resolve(data);
        }
        else {
          shouldLog(LogLevel.Midi) && console.log(`sendAndGetReply received MIDI data of length ${data.length} that failed verifyReply`);
        }
      };
      this.addListener(inputDevice, handleReply);
      this.send(outputDevice, data);
    });
    // leftover code to compare two datasets:
    // replyStart.length === 0 || data.length >= replyStart.length && data.slice(0, replyStart.length).every((element, index) => element === replyStart[index])
  }
  public setMuteState(deviceHandle: DeviceID, messageType: MessageType, mute: boolean): void
  {
    let deviceMutes = this.messageMutes.get(deviceHandle);
    if (deviceMutes === undefined) {
      deviceMutes = new Map<MessageType, boolean>();
      this.messageMutes.set(deviceHandle, deviceMutes);
    }
    deviceMutes.set(messageType, mute);
  }

  public getMuteStates(deviceHandle: DeviceID): Map<MessageType, boolean> | undefined
  {
    return this.messageMutes.get(deviceHandle);
  }
  
  // public getMuteState(deviceHandle: DeviceID, messageType: MessageType): boolean
  // {
  //   let deviceMutes = this.messageMutes.get(deviceHandle);
  //   if (deviceMutes === undefined)
  //     return false;
  //   let mute = deviceMutes.get(messageType);
  //   return mute ?? false;
  // }

}