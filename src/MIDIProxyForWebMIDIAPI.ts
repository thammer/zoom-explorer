
import { DeviceID, DeviceInfo, MIDIProxy, ListenerType, ConnectionListenerType, DeviceState, PortType } from "./midiproxy.js";
import { bytesToHexString } from "./tools.js";
//import jzz from "jzz";

// Copied from https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/webmidi/index.d.ts
interface Navigator {
  /**
   * When invoked, returns a Promise object representing a request for access to MIDI
   * devices on the user's system.
   */
  requestMIDIAccess(options?: MIDIOptions): Promise<MIDIAccess>;
}

export class MIDIProxyForWebMIDIAPI extends MIDIProxy
{
  private midi: MIDIAccess | undefined;   
  private navigator: Navigator;
  private midiMessageListenerMap = new Map<DeviceID, ListenerType[]>();
  private connectionStateChangeListeners = new Array<ConnectionListenerType>();

  constructor() 
  {
    super();
    this.navigator = navigator;
    this.midi = undefined;
  }

  async enable() : Promise<boolean>
  {
    try
    {
      this.midi = await this.navigator.requestMIDIAccess({sysex: true});
      // console.log(`Web MIDI API Enabled`);
      this.enabled = true;
      // this.midi.onstatechange = (ev: Event) => {
      //   let event = ev as MIDIConnectionEvent;
      // }
      //this.midi.onstatechange = (event: MIDIConnectionEvent) => this.onStateChange(event);
      this.midi.onstatechange = (ev: Event) => {
        let event = ev as MIDIConnectionEvent;
        this.onStateChange(event);
      }
      return true;
    }
    catch(err)
    {
      console.error("ERROR: Error while enabling Web MIDI API");
      throw err;
    }
  }

  get inputs() 
  {
    let map = new Map<DeviceID, DeviceInfo>();
    if (this.midi === undefined) return map;

    this.midi.inputs.forEach( (info, id) =>
    {
      map.set(info.id, { 
        id: info.id, 
        name: info.name ?? "unknown", 
        state: info.state, 
        connection: info.connection === "open" ? "open" : info.connection === "closed" ? "closed" : "pending" 
      });
    });
    return map;
  }

  get outputs() 
  {
    let map = new Map<DeviceID, DeviceInfo>();
    if (this.midi === undefined) return map;

    this.midi.outputs.forEach( (info, id) =>
      {
        map.set(info.id, { 
          id: info.id, 
          name: info.name ?? "unknown", 
          state: info.state, 
          connection: info.connection === "open" ? "open" : info.connection === "closed" ? "closed" : "pending" 
        });
      });
      return map;
  }

  async openInput(id: DeviceID) : Promise<DeviceID>
  {
    if (this.midi === undefined)
      throw `Attempting to open MIDI input without first enabling Web MIDI`;

    let input = this.midi.inputs.get(id);
    if (input === undefined)
    {
      throw `No input found with ID "${id}"`;
    }

    await input.open();

    if (!this.midiMessageListenerMap.has(id))
      this.midiMessageListenerMap.set(id, new Array<ListenerType>());

    input.onmidimessage = (message) => {
      if (input !== undefined)
        this.onMIDIMessage(id, input, message);
    };

    return input.id;
  }
  
  async closeInput(deviceHandle: DeviceID) : Promise<DeviceID>
  {
    if (this.midi === undefined)
      throw `Attempting to close MIDI input without first enabling Web MIDI`;

    let input = this.midi.inputs.get(deviceHandle);
    if (input === undefined) {
      console.log(`No input found with ID "${deviceHandle}", so there's nothing to close. Removing listeners anyway.`);
    }
    else {
      await input.close();
    }
    
    let listeners = this.midiMessageListenerMap.get(deviceHandle);
    if (listeners === undefined)
      throw `Attemped to remove all listeners for device "${deviceHandle}" with no listener list`;

    // Remove all listeners
    this.midiMessageListenerMap.set(deviceHandle, new Array<ListenerType>());

    return deviceHandle;
  }

  async closeAllInputs() : Promise<void>
  {
    if (this.midi === undefined)
      throw `Attempting to close MIDI input without first enabling Web MIDI`;

    for (let [id, input] of this.midi.inputs.entries())
    {
      input.close();
    }
  }

  getInputInfo(id: DeviceID) : DeviceInfo
  {
    if (this.midi === undefined)
      throw `Attempting to get MIDI input info for device "${id}" without first enabling Web MIDI`;

    let info = this.midi.inputs.get(id);
    if (info === undefined)
    {
      throw `No input found with ID "${id}"`;
    }

    return { 
      id: info.id, 
      name: info.name ?? "unknown", 
      state: info.state, 
      connection: info.connection === "open" ? "open" : info.connection === "closed" ? "closed" : "pending" 
    }
  }
 
  async openOutput(id: DeviceID) : Promise<DeviceID>
  {
    if (this.midi === undefined)
      throw `Attempting to open MIDI output without first enabling Web MIDI`;

    let output = this.midi.outputs.get(id);
    if (output === undefined)
    {
      throw `No output found with ID "${id}"`;
    }

    await output.open();
    
    return output.id;
  }

  async closeOutput(deviceHandle: DeviceID) : Promise<DeviceID>
  {
    if (this.midi === undefined)
      throw `Attempting to close MIDI output without first enabling Web MIDI`;

    let output = this.midi.outputs.get(deviceHandle);
    if (output === undefined) {
      console.log(`No output found with ID "${deviceHandle}", so there's nothing to close`);
    }
    else {
      await output.close();
    }
    
    return deviceHandle;
  }

  async closeAllOutputs() : Promise<void>
  {
    if (this.midi === undefined)
      throw `Attempting to close MIDI output without first enabling Web MIDI`;

    for (let [id, output] of this.midi.outputs.entries())
    {
      output.close();
    }
  }

  getOutputInfo(id: DeviceID) : DeviceInfo
  {
    if (this.midi === undefined)
      throw `Attempting to get MIDI output info for device "${id}" without first enabling Web MIDI`;

    let info = this.midi.outputs.get(id);
    if (info === undefined)
    {
      throw `No output found with ID "${id}"`;
    }

    return { 
      id: info.id, 
      name: info.name ?? "unknown", 
      state: info.state, 
      connection: info.connection === "open" ? "open" : info.connection === "closed" ? "closed" : "pending" 
    }
  }

  send(deviceHandle: DeviceID, data: Uint8Array) : void
  {
    if (this.midi === undefined)
      throw `Attempting to send MIDI data to output for device "${deviceHandle}" without first enabling Web MIDI`;

    let output = this.midi.outputs.get(deviceHandle);
    if (output === undefined)
    {
      throw `No output found with ID "${deviceHandle}"`;
    }

    // FIXME: This shouldn't be necessary with the browser based Web MIDI API
    let dataArray = Array.from(data);
    if (this.loggingEnabled)
      console.log(`${performance.now().toFixed(1)} Sent: ${bytesToHexString(dataArray, " ")}`)
    output.send(dataArray);
  }


  addListener(deviceHandle: DeviceID, listener: ListenerType): void
  {
    if (this.midi === undefined)
      throw `Attempting to get add midi event listener for device "${deviceHandle}" without first enabling Web MIDI`;

    let input = this.midi.inputs.get(deviceHandle);
    if (input === undefined)
    {
      throw `No input found with ID "${deviceHandle}"`;
    }

    let listeners = this.midiMessageListenerMap.get(deviceHandle);
    if (listeners === undefined)
      throw `Attemped to add listener for device "${deviceHandle}" with no listener list`;

    listeners.push(listener);
  }

  removeListener(deviceHandle: DeviceID, listener: ListenerType): void
  {
    if (this.midi === undefined)
      throw `Attempting to get midi event listener for device "${deviceHandle}" without first enabling Web MIDI`;

    let input = this.midi.inputs.get(deviceHandle);
    if (input === undefined)
    {
      console.log(`No input found with ID "${deviceHandle}". Removing listener anyway.`);
    }

    let listeners = this.midiMessageListenerMap.get(deviceHandle);
    if (listeners === undefined)
      throw `Attemped to remove listener for device "${deviceHandle}" with no listener list`;

    this.midiMessageListenerMap.set(deviceHandle, listeners.filter( (l) => l !== listener));
  }

  removeAllListeners(deviceHandle: DeviceID): void
  {
    if (this.midi === undefined)
      throw `Attempting to get midi event listener for device "${deviceHandle}" without first enabling Web MIDI`;

    let input = this.midi.inputs.get(deviceHandle);
    if (input === undefined)
    {
      throw `No input found with ID "${deviceHandle}"`;
    }

    let listeners = this.midiMessageListenerMap.get(deviceHandle);
    if (listeners === undefined)
      throw `Attemped to remove all listeners for device "${deviceHandle}" with no listener list`;

    this.midiMessageListenerMap.set(deviceHandle, new Array<ListenerType>());
  }

  addConnectionListener(listener: ConnectionListenerType): void
  {
    let existingListener = this.connectionStateChangeListeners.find( (l) => l === listener);
    if (existingListener !== undefined)
    {
      console.warn(`Attempting to add a connection listener twice`);
    }
    else
    {
      this.connectionStateChangeListeners.push(listener);
    }
  }

  removeConnectionListener(listener: ConnectionListenerType): void
  {
    let existingListener = this.connectionStateChangeListeners.find( (l) => l === listener);
    if (existingListener === undefined)
    {
      console.warn(`Attempting to remove a connection listener that hasn't been added`);
    }
    else
    {
      this.connectionStateChangeListeners = this.connectionStateChangeListeners.filter( (l) => l === listener);
    }
  }

  onMIDIMessage(deviceHandle: DeviceID, input: MIDIInput, message:MIDIMessageEvent)
  {
    let listeners = this.midiMessageListenerMap.get(deviceHandle);
    if (listeners === undefined)
      throw `Received MIDI message from device "${deviceHandle}" with no listener list`;

    for (let listener of listeners)
    {
      if (message.data !== null)
        listener(deviceHandle, message.data);    
      else
        console.warn("message.data == null");  
    }
  }

  /**
   * Handles MIDI connection state changes by notifying registered listeners. 
   * Note that this method might get called rapidly multiple times on connection and disconnection.
   * The number of disconnect events seems to match the prevoius number of connect events (on starting the application).
   * I suspect this is due to a bug in the Web MIDI API implementation in Chrome.
   *
   * @param {MIDIConnectionEvent} event - The MIDI connection event that triggered this state change.
   */
  onStateChange(event: MIDIConnectionEvent)
  {
    for (let listener of this.connectionStateChangeListeners)
    {
      if (event.port !== null)
      {
        let deviceHandle = event.port.id;
        let portType: PortType = event.port.type === "input" ? "input" : "output";
        let state: DeviceState = event.port.state == "connected" ? "connected" : "disconnected";
        listener(deviceHandle, portType, state);        
      }
      else
        console.warn("event.port === null");
    }
  }
}
