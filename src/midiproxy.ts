
/**
 * Module MIDIProxy provides the MIDIProxy class
 * @module MIDIProxy
 */

export type DeviceID = string;

export type DeviceState = "connected" | "disconnected" | "unknown";

export type DeviceInfo = 
{
  id: string,
  name: string,
  state: DeviceState,
  connection: "open" | "closed" | "pending" | "unknown";
}

export type ListenerType = (deviceHandle: DeviceID, data: Uint8Array) => void;
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
  SysExEnd =    0b11110111
}

export interface IMIDIProxy 
{
  loggingEnabled: boolean;

  readonly inputs: Map<DeviceID, DeviceInfo>; 
  readonly outputs: Map<DeviceID, DeviceInfo>;
  get enabled(): boolean; 

  enable() : Promise<boolean>;

  openInput(id: DeviceID) : Promise<DeviceID>;
  closeInput(deviceHandle: DeviceID) : Promise<DeviceID>;
  closeAllInputs() : Promise<void>;
  getInputInfo(id: DeviceID) : DeviceInfo;

  openOutput(id: DeviceID) : Promise<DeviceID>;
  closeOutput(deviceHandle: DeviceID) : Promise<DeviceID>;
  closeAllOutputs() : Promise<void>;
  getOutputInfo(id: DeviceID) : DeviceInfo;

  send(deviceHandle: DeviceID, data: number[] | Uint8Array) : void;
  sendPC(deviceHandle: DeviceID, channel: number, program: number) : void;
  sendCC(deviceHandle: DeviceID, channel: number, ccNumber: number, ccValue: number) : void;
  sendAndGetReply(inputDevice: DeviceID, data: number[] | Uint8Array, outputDevice: DeviceID, verifyReply: (data: Uint8Array) => boolean, timeoutMilliseconds: number) : Promise<Uint8Array | undefined>;

  addListener(deviceHandle: DeviceID, listener: ListenerType): void;
  removeListener(deviceHandle: DeviceID, listener: ListenerType): void;

  addConnectionListener(listener: ConnectionListenerType): void;
  removeConnectionListener(listener: ConnectionListenerType): void;

  getChannelMessage(data: Uint8Array): [MessageType, number, number, number];
}

/**
 * Implements some common convenience methods for classes that implement IMIDIProxy 
 */
export abstract class MIDIProxy implements IMIDIProxy
{
  protected messageBuffer2: Uint8Array;
  protected messageBuffer3: Uint8Array;

  public loggingEnabled: boolean = true;

  constructor()
  {
    this.messageBuffer2 = new Uint8Array([0, 0]); 
    this.messageBuffer3 = new Uint8Array([0, 0, 0]); 
  }

  abstract readonly inputs: Map<DeviceID, DeviceInfo>; 
  abstract readonly outputs: Map<DeviceID, DeviceInfo>; 
  abstract enable() : Promise<boolean>;

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

  public sendPC(deviceHandle: DeviceID, channel: number, program: number) : void
  {
    this.messageBuffer2[0] = MessageType.CC + channel && 0b00001111;
    this.messageBuffer2[1] = program && 0b01111111;
    this.send(deviceHandle, this.messageBuffer2);
  }

  public sendCC(deviceHandle: DeviceID, channel: number, ccNumber: number, ccValue: number) : void
  {
    this.messageBuffer3[0] = MessageType.CC + channel && 0b00001111;
    this.messageBuffer3[1] = ccNumber && 0b01111111;
    this.messageBuffer3[2] = ccValue && 0b01111111;
    this.send(deviceHandle, this.messageBuffer3);
  }

  public sendAndGetReply(outputDevice: DeviceID, data: number[] | Uint8Array, inputDevice: DeviceID, verifyReply: (data: Uint8Array) => boolean, 
                         timeoutMilliseconds: number = 100) : Promise<Uint8Array | undefined>
  {
    return new Promise<Uint8Array | undefined> ( (resolve, reject) => {
      let timeoutId = setTimeout( () => {
        console.log(`sendAndGetReply() Timed out (${timeoutId}) for output device "${outputDevice}", input device "${inputDevice}"`);
        this.removeListener(inputDevice, handleReply);
        resolve(undefined);
      }, timeoutMilliseconds);
      let handleReply = (deviceHandle: DeviceID, data: Uint8Array) => {
        if (verifyReply(data)) {
          clearTimeout(timeoutId);
          this.removeListener(deviceHandle, handleReply);
          resolve(data);
        }
        else
          console.log(`sendAndGetReply received MIDI data of length ${data.length} that failed verifyReply`);
      };
      this.addListener(inputDevice, handleReply);
      this.send(outputDevice, data);
    });

    // leftover code to compare two datasets:
    // replyStart.length === 0 || data.length >= replyStart.length && data.slice(0, replyStart.length).every((element, index) => element === replyStart[index])
  }

  public getChannelMessage(data: Uint8Array): [MessageType, number, number, number] 
  {
    if (data.length < 1)
      return [MessageType.Unknown, 0, 0, 0];
    else if (data.length === 1)
      return [data[0] & 0b11110000, data[0] & 0b00001111, 0, 0];
    else if (data.length === 2)
      return [data[0] & 0b11110000, data[0] & 0b00001111, data[1], 0];
    else return [data[0] & 0b11110000, data[0] & 0b00001111, data[1], data[2]];
  }    
}