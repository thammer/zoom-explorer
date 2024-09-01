import { DeviceID, DeviceInfo, DeviceState, IMIDIProxy, PortType } from "./midiproxy.js";
import { getMIDIDeviceList, MIDIDeviceDescription } from "./miditools.js";
import { SequentialAsyncRunner } from "./SequentialAsyncRunner.js";

export interface IMIDIDevice
{
  get isOpen(): boolean;
  get deviceInfo(): MIDIDeviceDescription;

  open(): Promise<void>;
  close(): Promise<void>;
}

export type MatchDeviceFunctionType = (device: MIDIDeviceDescription) => boolean; 
export type FactoryFuntionType = (midi: IMIDIProxy, midiDevice: MIDIDeviceDescription) => IMIDIDevice;
export type DisconnectListenerType = (deviceManager: MIDIDeviceManager, device: IMIDIDevice, key: string) => void;
export type ConnectListenerType = (deviceManager: MIDIDeviceManager, device: IMIDIDevice, key: string) => void;

/**
 * Maintains a list of MIDI devices.
 * Factory for each manufacturer device
 * ZoomDevice
 * GenericMIDIDevice - think about how to handle uni-directonal devices...
 */
export class MIDIDeviceManager
{
  private _midi: IMIDIProxy;
  private _factories: Map<string, {matchDevice: MatchDeviceFunctionType, createObject: FactoryFuntionType}> = new Map<string, {matchDevice: MatchDeviceFunctionType, createObject: FactoryFuntionType}>();
  private _deviceList: Map<string, IMIDIDevice[]> = new Map<string, IMIDIDevice[]>();
  private _midiDeviceList: MIDIDeviceDescription[] = [];
  private _disconnectListeners: DisconnectListenerType[] = new Array<DisconnectListenerType>();
  private _connectListeners: ConnectListenerType[] = new Array<ConnectListenerType>();
  private _sequentialRunner = new SequentialAsyncRunner();
  private _concurrentRunsCounter = 0;

  constructor(midi: IMIDIProxy)
  {
    this._midi = midi;
    this._midi.addConnectionListener((deviceHandle: string, portType: PortType, state: DeviceState) => {
      this.midiConnectionHandler(deviceHandle, portType, state);
    });
  }
  
  /**
   * Adds a factory function for a specific device type.
   *
   * @param {string} key - The unique identifier for the device type. For instance "ZoomDevice".
   * @param {MatchDeviceFunctionType} matchDevice - The function to match the device.
   * @param {FactoryFuntionType} createObject - The function to create the device object.
   * @return {void}
   */
  public addFactoryFunction(key: string, matchDevice: MatchDeviceFunctionType, createObject: FactoryFuntionType): void
  { 
    this._factories.set(key, {matchDevice: matchDevice, createObject: createObject});
  }
  
  async updateMIDIDeviceList(): Promise<Map<string, IMIDIDevice[]> | undefined>
  {
    return await this._sequentialRunner.run(this.updateMIDIDeviceListSerial.bind(this));
    // while (this._updatePromises.length > 0) {
    //   await this._updatePromises[0];
    //   this._updatePromises.shift();
    // }
    // let p = this.updateMIDIDeviceList();
    // this._updatePromises.push(p);
    // await Promise.all(this._updatePromises)
    // return p;
  }

  async updateMIDIDeviceListSerial(): Promise<Map<string, IMIDIDevice[]> | undefined>
  {
    this._concurrentRunsCounter++;

    if (this._concurrentRunsCounter > 40) {
      console.error("Too many concurrent calls to updateMIDIDeviceList() - counter = " + this._concurrentRunsCounter);
      return undefined;
    }

    console.log(`Starting updateMIDIDeviceList - counter = ${this._concurrentRunsCounter}`);
    let inputs: Map<string, DeviceInfo> = new Map<string, DeviceInfo>(this._midi.inputs);
    let outputs: Map<string, DeviceInfo> = new Map<string, DeviceInfo>(this._midi.outputs);
  
    for (let device of this._midiDeviceList) {
      inputs.delete(device.inputID);
      outputs.delete(device.outputID);
    }

    if (inputs.size === 0 || outputs.size === 0) {
      this._concurrentRunsCounter--;
      console.log(`Aborting updateMIDIDeviceList since number of inputs or outputs were 0 - counter = ${this._concurrentRunsCounter}`);
      return undefined;
    }

    // Pair up devices that have not already been paired up
    let newDeviceDescriptors = await getMIDIDeviceList(this._midi, inputs, outputs, 100, true);

    if (newDeviceDescriptors.length === 0) {
      this._concurrentRunsCounter--;
      console.log(`Aborting updateMIDIDeviceList since no new devices were matched up - counter = ${this._concurrentRunsCounter}`);
      return undefined;
    }

    for (let device of newDeviceDescriptors) {
      if (this._midiDeviceList.includes(device)) {
        console.error(`Device ${device.deviceName} (${device.inputName}, ${device.outputName}) already in list`);
      }
      else {
        this._midiDeviceList.push(device);
      }
    }

    let newDevices: Map<string, IMIDIDevice[]> = new Map<string, IMIDIDevice[]>();

    for (let typeID of this._factories.keys()) {
      let matchDevice = this._factories.get(typeID)!.matchDevice;
      let createObject = this._factories.get(typeID)!.createObject;
      let matchingDeviceDescriptors = newDeviceDescriptors.filter((device) => matchDevice(device));
      let matchingDevices: IMIDIDevice[];
      if (matchingDeviceDescriptors.length > 0) {
        matchingDevices = matchingDeviceDescriptors.map((device) => createObject(this._midi, device));
      }
      else 
        matchingDevices = [];
      let existingDevices = this._deviceList.get(typeID);
      if (existingDevices === undefined)
        this._deviceList.set(typeID, matchingDevices);
      else 
        this._deviceList.set(typeID, existingDevices.concat(matchingDevices));
      newDevices.set(typeID, matchingDevices);
    }

    this._concurrentRunsCounter--;
    console.log(`Completed updateMIDIDeviceList  - counter = ${this._concurrentRunsCounter}`);
    return newDevices;
  }

  public get midiDeviceList(): MIDIDeviceDescription[] {
    return this._midiDeviceList;
  }

  public getDevices(typeID: string): IMIDIDevice[]
  {
    let device = this._deviceList.get(typeID);
    return device ?? [];
  }

  public addDisconnectListener(listener: DisconnectListenerType): void
  {
    this._disconnectListeners.push(listener);
  }

  public removeDisconnectListener(listener: DisconnectListenerType): void
  {
    this._disconnectListeners = this._disconnectListeners.filter( (l) => l !== listener);
  }

  public removeAllDisconnectListeners(): void
  {
    this._disconnectListeners = [];
  }

  private emitDisconnectEvent(device: IMIDIDevice, key: string) {
    for (let listener of this._disconnectListeners)
      listener(this, device, key);
  }

  public addConnectListener(listener: ConnectListenerType): void
  {
    this._connectListeners.push(listener);
  }

  public removeConnectListener(listener: ConnectListenerType): void
  {
    this._connectListeners = this._connectListeners.filter( (l) => l !== listener);
  } 

  public removeAllConnectListeners(): void
  {
    this._connectListeners = [];
  }

  private emitConnectEvent(device: IMIDIDevice, key: string) {
    for (let listener of this._connectListeners)
      listener(this, device, key);
  }

  private getDeviceFromHandle(deviceHandle: string): [device: IMIDIDevice | undefined, key: string | undefined]
  {
    for (let [key, deviceList] of this._deviceList) {
      let device = deviceList.find( (device) => device.deviceInfo.inputID === deviceHandle || device.deviceInfo.outputID === deviceHandle);
      if (device !== undefined)
        return [device, key];
    }
    return [undefined, undefined];
  }
  
  private getDeviceName(deviceHandle: string, portType: PortType): string
  {
    if (!this._midi.isDeviceConnected(deviceHandle, portType)) {
      console.log(`MIDIDeviceManager.getDeviceName() called for unconnected device ${deviceHandle}`);
      return "";
    }
    else 
      return this._midi.getDeviceInfo(deviceHandle, portType).name;
  }

  private midiConnectionHandler(deviceHandle: string, portType: PortType, state: string) {
    let deviceName = this.getDeviceName(deviceHandle, portType);
    console.log(`MIDIDeviceManager: MIDI Connection event for device "${deviceName}" (${deviceHandle}), portType: ${portType}, state: ${state}`);

    if (state === "disconnected") {
      let [disconnectedDevice, deviceKey] = this.getDeviceFromHandle(deviceHandle);  
      if (disconnectedDevice !== undefined && deviceKey !== undefined) {
        if (disconnectedDevice.isOpen) {
          console.log(`Device ${disconnectedDevice.deviceInfo.deviceName} disconnected because ${portType} "${deviceName}" (${deviceHandle}) was ${state}`);

          console.log(`Closing device ${deviceHandle} and removing from midiDeviceList`);
          disconnectedDevice.close();
        }
        else {
          console.log(`Device ${disconnectedDevice.deviceInfo.deviceName} disconnected. Skipping close() as it was already closed`);
        }

        this._midiDeviceList = this._midiDeviceList.filter( (device) => device.inputID !== deviceHandle && device.outputID !== deviceHandle);
        let deviceList = this._deviceList.get(deviceKey);
        if (deviceList !== undefined) {
          this._deviceList.set(deviceKey, deviceList.filter( (device) => device.deviceInfo.inputID !== deviceHandle && device.deviceInfo.outputID !== deviceHandle));
        }
        this.emitDisconnectEvent(disconnectedDevice, deviceKey);
      }
    }
    else if (state === "connected") {
      console.log(`${portType} device "${deviceName}" (${deviceHandle}) connected`);
      let [existingDevice, deviceKey] = this.getDeviceFromHandle(deviceHandle);        
      // let existingDevice: ZoomDevice | undefined = zoomDevices.find( (device) => device.deviceInfo.outputID === deviceHandle);
      if (existingDevice !== undefined) {
        console.log(`Device "${deviceName}" (${deviceHandle}) is already in the device list for ${deviceKey}. This should only happen on startup.`);
      }
      else {
        console.log(`Device "${deviceName}" (${deviceHandle}) is not in the device list. Updating MIDI device list`);
        // let newDevices = await this.updateMIDIDeviceList();
        this.updateMIDIDeviceList().then((newDevices) => {
          if (newDevices !== undefined) {
            if (newDevices.size > 1) {
              console.warn(`Multiple devices of multiple types created when device "${deviceName}" (${deviceHandle}) was connected. This is weird. Investigate.`);
            }
            for (let [deviceKey, newDevicesForKey] of newDevices) {
              if (newDevicesForKey.length > 1) {
                console.warn(`Multiple devices created when device "${deviceName}" (${deviceHandle}) was connected. This is weird. Investigate.`);
              }
              for (let newDevice of newDevicesForKey) {
                this.emitConnectEvent(newDevice, deviceKey!);                          
              }
            }
          }
        });
      }
    }  
  }
}
 
