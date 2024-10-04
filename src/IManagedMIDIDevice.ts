import { MIDIDeviceDescription } from "./MIDIDeviceDescription";

export interface IManagedMIDIDevice
{
  get isOpen(): boolean;
  get deviceInfo(): MIDIDeviceDescription;

  open(): Promise<void>;
  close(): Promise<void>;
}
