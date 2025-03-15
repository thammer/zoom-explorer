import { MIDIDeviceDescription } from "./MIDIDeviceDescription";
import { MessageType } from "./midiproxy";

export type MIDIDataListenerType = (device: IManagedMIDIDevice, data: Uint8Array) => void;
export type MIDIDeviceOpenCloseListenerType = (device: IManagedMIDIDevice, open: boolean) => void;

export interface IManagedMIDIDevice
{
  get isOpen(): boolean;
  get deviceInfo(): MIDIDeviceDescription;
  get deviceName(): string; // should always be unique
  set deviceName(name: string); 

  open(): Promise<void>;
  close(): Promise<void>;

  addListener(listener: MIDIDataListenerType): void
  removeListener(listener: MIDIDataListenerType): void
  removeAllListeners(): void

  addOpenCloseListener(listener: MIDIDeviceOpenCloseListenerType): void
  removeOpenCloseListener(listener: MIDIDeviceOpenCloseListenerType): void
  removeAllOpenCloseListeners(): void

  setMuteState(messageType: MessageType, mute: boolean): void
}
