import { MIDIDeviceDescription } from "./MIDIDeviceDescription";

export type MIDIDataListenerType = (device: IManagedMIDIDevice, data: Uint8Array) => void;

export interface IManagedMIDIDevice
{
  get isOpen(): boolean;
  get deviceInfo(): MIDIDeviceDescription;

  open(): Promise<void>;
  close(): Promise<void>;

  addListener(listener: MIDIDataListenerType): void
  removeListener(listener: MIDIDataListenerType): void
  removeAllListeners(): void
}
