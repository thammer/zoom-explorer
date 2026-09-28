
import { shouldLog, LogLevel } from "./Logger.js";
import { DeviceID, DeviceInfo, MIDIProxy, ListenerType, ConnectionListenerType, DeviceState, PortType, ALL_MIDI_DEVICES } from "./midiproxy.js";
import { getChannelMessage } from "./miditools.js";
import { MIDI_RECEIVE, MIDI_RECEIVE_TO_SEND, MIDI_SEND, MIDI_TIMESTAMP_TO_RECEIVE, perfmon } from "./PerformanceMonitor.js";
import { bytesToHexString, getFunctionName } from "./tools.js";
import { ZoomDriverDiagnostics } from "./ZoomDriverDiagnostics.js";
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
  private inputPortsConnectionState = new Map<DeviceID, MIDIPortConnectionState>;
  private outputPortsConnectionState = new Map<DeviceID, MIDIPortConnectionState>;
  // How many times each port has been opened through this proxy and not yet closed.
  // Several parts of an application share one port: a device driver, a file transfer,
  // and the device identification pass all open the same pedal. Closing the underlying
  // port stops delivery for every one of them, and closing an input also drops every
  // listener registered on it, so a port is only really closed when its last holder
  // closes it. A close with no matching open is refused and reported, since acting on it
  // would give back a hold that belongs to another part of the application.
  private inputOpenCount = new Map<DeviceID, number>();
  private outputOpenCount = new Map<DeviceID, number>();

  constructor() 
  {
    super();
    this.navigator = navigator;
    this.midi = undefined;
    this.midiMessageListenerMap.set(ALL_MIDI_DEVICES, new Array<ListenerType>());
  }

  async enable() : Promise<boolean>
  {
    try
    {
      this.midi = await this.navigator.requestMIDIAccess({sysex: true});
      this.enabled = true;
      this.midi.onstatechange = (ev: Event) => {
        let event = ev as MIDIConnectionEvent;
        // shouldLog(LogLevel.Info) && console.log(`*** ${event.port?.type} ${event.port?.state} ${event.port?.name} ${event.port?.connection}`);
        if (event.port === null)
          return;

        // Skip state change events from already connected ports - ignoring open and close port state change events
        let skipStateChange = false;

        skipStateChange = event.port.state === "connected" && (event.port.type === "input" && this.inputPortsConnectionState.has(event.port.id) || 
          event.port.type === "output" && this.outputPortsConnectionState.has(event.port.id));

        if (!skipStateChange)
          this.onStateChange(event);
        // else
        //   shouldLog(LogLevel.Info) && console.log(`*** Not emitting state change for ${event.port?.type} ${event.port?.state} ${event.port?.name} ${event.port?.connection}`);

        if (event.port.state === "disconnected")
          if (event.port.type === "input")
            this.inputPortsConnectionState.delete(event.port.id);
          else
            this.outputPortsConnectionState.delete(event.port.id);
        else
          if (event.port.type === "input")
            this.inputPortsConnectionState.set(event.port.id, event.port.connection);
          else
            this.outputPortsConnectionState.set(event.port.id, event.port.connection);

      }
      return true;
    }
    catch(err)
    {
      shouldLog(LogLevel.Error) && console.error("ERROR: Error while enabling Web MIDI API");
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
    if (this.midi === undefined) {
      console.trace();
      throw `Attempting to open MIDI input without first enabling Web MIDI`;
    }

    let input = this.midi.inputs.get(id);
    if (input === undefined)
    {
      console.trace();
      throw `No input found with ID "${id}" in ${getFunctionName()}`;
    }

    await input.open();

    if (!this.midiMessageListenerMap.has(id))
      this.midiMessageListenerMap.set(id, new Array<ListenerType>());

    // Counting the hold and installing the handler must stay in one synchronous block:
    // closeInput() relies on a holder that has been counted having its handler installed
    // already, so it can hand the port back without losing messages. Do not put an await
    // between these two lines.
    this.inputOpenCount.set(id, (this.inputOpenCount.get(id) ?? 0) + 1);

    this.attachMessageHandler(id, input);

    return input.id;
  }

  /**
   * Whether a port is probably a Zoom device's, from its name or manufacturer. Used for the
   * port_close_unbalanced diagnostic in place of the port's name or id: a name can be
   * renamed by the user, and an id is a stable identifier, and neither belongs in a report
   * that may leave the machine. Chrome names an MS Plus pedal's ports "ZOOM MS Plus Series".
   */
  private static looksLikeZoomPort(port: MIDIPort | undefined): boolean
  {
    if (port === undefined)
      return false;
    return /zoom/i.test(port.name ?? "") || /zoom/i.test(port.manufacturer ?? "");
  }

  /**
   * Routes a port's incoming messages into this proxy. Chrome keeps onmidimessage across
   * a close and reopen (measured on an MS-70CDR+), but the specification lets a port lose
   * it, so anything that reopens a port sets it again rather than relying on that.
   */
  private attachMessageHandler(id: DeviceID, input: MIDIInput): void
  {
    input.onmidimessage = (message) => {
      if (input !== undefined) {
        perfmon.exitWithExplicitLastTimeInside(MIDI_TIMESTAMP_TO_RECEIVE, message.timeStamp);
        perfmon.enter(MIDI_RECEIVE);
        perfmon.enter(MIDI_RECEIVE_TO_SEND);

        this.onMIDIMessage(id, input, message);
      }
    };
  }
  
  async closeInput(deviceHandle: DeviceID) : Promise<DeviceID>
  {
    if (this.midi === undefined)
      throw `Attempting to close MIDI input without first enabling Web MIDI`;

    const openCount = this.inputOpenCount.get(deviceHandle) ?? 0;
    if (openCount > 1) {
      this.inputOpenCount.set(deviceHandle, openCount - 1);
      shouldLog(LogLevel.Info) && console.log(`Not closing input device "${deviceHandle}": ${openCount - 1} more holder(s) have it open. Listeners are left in place.`);
      return deviceHandle;
    }
    if (openCount === 0) {
      // Refused rather than obeyed: the count is per port, so this close would give back a
      // hold taken by another part of the application, closing the port under it and
      // dropping its listeners. No legitimate caller closes a port it did not open.
      shouldLog(LogLevel.Warning) && console.warn(`Refusing to close input device "${deviceHandle}", which was never opened through this proxy. Opens and closes are unbalanced somewhere.`);
      ZoomDriverDiagnostics.notify({ kind: "port_close_unbalanced", portType: "input",
        looksLikeZoomPort: MIDIProxyForWebMIDIAPI.looksLikeZoomPort(this.midi.inputs.get(deviceHandle)) });
      return deviceHandle;
    }
    // Deleted, not decremented: a holder that opens the port while it is closing below
    // adds its own count back, which is how the close notices and hands the port over.
    this.inputOpenCount.delete(deviceHandle);

    let input = this.midi.inputs.get(deviceHandle);
    if (input === undefined) {
      shouldLog(LogLevel.Info) && console.log(`No input found with ID "${deviceHandle}", so there's nothing to close. Removing listeners anyway.`);
    }
    else {
      // A close that fails keeps its hold, so a later close can still release the port.
      // Giving the hold up here would leave the port open with nothing able to close it,
      // now that a close at count zero is refused.
      try
      {
        await input.close();
      }
      catch(err)
      {
        this.inputOpenCount.set(deviceHandle, (this.inputOpenCount.get(deviceHandle) ?? 0) + 1);
        throw err;
      }

      // Closing a port takes a moment, and a new holder can open it in that moment.
      // It would then be left with a closed port and, below, with its listeners gone.
      // Put the port back instead, and leave the listeners alone.
      if ((this.inputOpenCount.get(deviceHandle) ?? 0) > 0) {
        shouldLog(LogLevel.Info) && console.log(`Input device "${deviceHandle}" was opened again while it was being closed. Reopening it and keeping its listeners.`);
        // The failure here belongs to the new holder, not to whoever called close, so it
        // is reported rather than thrown: throwing would tell the wrong caller, and the
        // new holder would be left with a closed port and no hint why.
        try
        {
          await input.open();
          this.attachMessageHandler(deviceHandle, input);
        }
        catch(err)
        {
          shouldLog(LogLevel.Error) && console.error(`Failed to reopen input device "${deviceHandle}" for the holder that opened it while it was closing: ${err}`);
        }
        return deviceHandle;
      }
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

    this.inputOpenCount.clear(); // these ports are closed whatever the counts said
  }

  getInputInfo(id: DeviceID) : DeviceInfo
  {
    if (this.midi === undefined)
      throw `Attempting to get MIDI input info for device "${id}" without first enabling Web MIDI`;

    let info = this.midi.inputs.get(id);
    if (info === undefined)
    {
      console.trace();
      throw `No input found with ID "${id}" in ${getFunctionName()}`;
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

    this.outputOpenCount.set(id, (this.outputOpenCount.get(id) ?? 0) + 1);

    return output.id;
  }

  async closeOutput(deviceHandle: DeviceID) : Promise<DeviceID>
  {
    if (this.midi === undefined)
      throw `Attempting to close MIDI output without first enabling Web MIDI`;

    const openCount = this.outputOpenCount.get(deviceHandle) ?? 0;
    if (openCount > 1) {
      this.outputOpenCount.set(deviceHandle, openCount - 1);
      shouldLog(LogLevel.Info) && console.log(`Not closing output device "${deviceHandle}": ${openCount - 1} more holder(s) have it open.`);
      return deviceHandle;
    }
    if (openCount === 0) {
      shouldLog(LogLevel.Warning) && console.warn(`Refusing to close output device "${deviceHandle}", which was never opened through this proxy. Opens and closes are unbalanced somewhere.`);
      ZoomDriverDiagnostics.notify({ kind: "port_close_unbalanced", portType: "output",
        looksLikeZoomPort: MIDIProxyForWebMIDIAPI.looksLikeZoomPort(this.midi.outputs.get(deviceHandle)) });
      return deviceHandle;
    }
    this.outputOpenCount.delete(deviceHandle);

    let output = this.midi.outputs.get(deviceHandle);
    if (output === undefined) {
      shouldLog(LogLevel.Info) && console.log(`No output found with ID "${deviceHandle}", so there's nothing to close`);
    }
    else {
      try
      {
        await output.close();
      }
      catch(err)
      {
        this.outputOpenCount.set(deviceHandle, (this.outputOpenCount.get(deviceHandle) ?? 0) + 1);
        throw err;
      }

      // As in closeInput(): a new holder may have opened it while it was closing.
      if ((this.outputOpenCount.get(deviceHandle) ?? 0) > 0) {
        shouldLog(LogLevel.Info) && console.log(`Output device "${deviceHandle}" was opened again while it was being closed. Reopening it.`);
        try
        {
          await output.open();
        }
        catch(err)
        {
          shouldLog(LogLevel.Error) && console.error(`Failed to reopen output device "${deviceHandle}" for the holder that opened it while it was closing: ${err}`);
        }
      }
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

    this.outputOpenCount.clear(); // these ports are closed whatever the counts said
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

  isOutputConnected(id: DeviceID) : boolean
  {
    if (this.midi === undefined)
      return false;

    let info = this.midi.outputs.get(id);
    if (info === undefined)
      return false;

    if (info.state === "disconnected")
      return false;

    return true;
  }

  isInputConnected(id: DeviceID) : boolean
  {
    if (this.midi === undefined)
      return false;

    let info = this.midi.inputs.get(id);
    if (info === undefined)
      return false;

    if (info.state === "disconnected")
      return false;

    return true;
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

    // Note: This conversion might be needed for node.js, but is not needed for the browser based Web MIDI API
    //let dataArray = Array.from(data);
    let dataArray = data;
    shouldLog(LogLevel.Midi) && console.log(`${performance.now().toFixed(1)} Sent: ${bytesToHexString(dataArray, " ")}`)

    perfmon.enter(MIDI_SEND);
 
    output.send(dataArray);
    
    perfmon.exit(MIDI_SEND);
    perfmon.exit(MIDI_RECEIVE_TO_SEND);
  }

  addListener(deviceHandle: DeviceID, listener: ListenerType): void
  {
    if (deviceHandle !== ALL_MIDI_DEVICES) {
      if (this.midi === undefined)
        throw `Attempting to add midi event listener for device "${deviceHandle}" without first enabling Web MIDI`;

      let input = this.midi.inputs.get(deviceHandle);
      if (input === undefined)
      {
        console.trace();
        throw `No input found with ID "${deviceHandle}" in ${getFunctionName()}`;
      }
    }

    let listeners = this.midiMessageListenerMap.get(deviceHandle);
    if (listeners === undefined)
      throw `Attempted to add listener for device "${deviceHandle}" with no listener list`;

    listeners.push(listener);
  }

  removeListener(deviceHandle: DeviceID, listener: ListenerType): void
  {
    if (deviceHandle !== ALL_MIDI_DEVICES) {
      if (this.midi === undefined)
        throw `Attempting to get midi event listener for device "${deviceHandle}" without first enabling Web MIDI`;

      let input = this.midi.inputs.get(deviceHandle);
      if (input === undefined)
      {
        shouldLog(LogLevel.Info) && console.log(`No input found with ID "${deviceHandle}". Removing listener anyway.`);
      }
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
      console.trace();
      throw `No input found with ID "${deviceHandle}" in ${getFunctionName()}`;
    }

    let listeners = this.midiMessageListenerMap.get(deviceHandle);
    if (listeners === undefined)
      throw `Attemped to remove all listeners for device "${deviceHandle}" with no listener list`;

    this.midiMessageListenerMap.set(deviceHandle, new Array<ListenerType>());
  }

  /**
   * 
   * @param listener function to get called every time a device is connected or disconnected. 
   * Opening and closing a device does not result in the listener being called.
   */
  addConnectionListener(listener: ConnectionListenerType): void
  {
    let existingListener = this.connectionStateChangeListeners.find( (l) => l === listener);
    if (existingListener !== undefined)
    {
      shouldLog(LogLevel.Warning) && console.warn(`Attempting to add a connection listener twice`);
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
      shouldLog(LogLevel.Warning) && console.warn(`Attempting to remove a connection listener that hasn't been added`);
    }
    else
    {
      this.connectionStateChangeListeners = this.connectionStateChangeListeners.filter( (l) => l === listener);
    }
  }

  onMIDIMessage(deviceHandle: DeviceID, input: MIDIInput, message: MIDIMessageEvent)
  {
    if (message.data === null) {
      shouldLog(LogLevel.Warning) && console.warn("message.data == null");
      return;
    }
  
    let mute = false;
    let muteStates = this.getMuteStates(deviceHandle);
    if (muteStates !== undefined) {
      let [messageType, channel, data1, data2] = getChannelMessage(message.data); 
      mute = muteStates.get(messageType) ?? false;
      // if (mute) {
      //   console.warn(`Muting message ${messageType} for device ${deviceHandle}`);
      // }
    }
    if (mute) {
      return;
    }

    // shouldLog(LogLevel.Midi) && console.log(`${performance.now().toFixed(4)} ${message.timeStamp.toFixed(4)} Rcvd: ${bytesToHexString(message.data, " ")}`)

    // first, call listeners that listen for all midi devices
    let listeners = this.midiMessageListenerMap.get(ALL_MIDI_DEVICES);
    if (listeners !== undefined) {
      for (let listener of listeners)
        {
          if (message.data !== null)
            listener(deviceHandle, message.data, message.timeStamp);    
          else
            shouldLog(LogLevel.Warning) && console.warn("message.data == null");  
        }    
    }

    // then, call listeners that listen for this specific device
    listeners = this.midiMessageListenerMap.get(deviceHandle);
    if (listeners === undefined)
      throw `Received MIDI message from device "${deviceHandle}" with no listener list`;

    for (let listener of listeners)
    {
      if (message.data !== null)
        listener(deviceHandle, message.data, message.timeStamp);    
      else
        shouldLog(LogLevel.Warning) && console.warn("message.data == null");  
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
        shouldLog(LogLevel.Warning) && console.warn("event.port === null");
    }
  }
}
