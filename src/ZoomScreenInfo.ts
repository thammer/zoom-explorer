import { shouldLog, LogLevel } from "./Logger.js";
import { numberToHexString } from "./tools.js";
import { EffectParameterMap } from "./ZoomDevice.js";
import { ZoomPatch } from "./ZoomPatch.js";


export class ZoomScreenParameter
{
  name: string = "";
  valueString: string = "";
  invert: boolean = false;
  unknownFlag: boolean = false;
  valueType: number = 0; // mostly for debugging, interpreted type is reflected in the invert and the name/value strings
  nameType: number = 0; // mostly for debugging, interpreted type is reflected in the invert and the name/value strings
  valueInvertByte: number = 0;
  nameInvertByte: number = 0;
  public equals(other: ZoomScreenParameter): boolean
  {
    return this.name === other.name && this.valueString === other.valueString;
  }
}

export class ZoomScreen
{
  parameters: Array<ZoomScreenParameter> = new Array<ZoomScreenParameter>();
  public equals(other: ZoomScreen): boolean
  {
    return this.parameters.length === other.parameters.length && this.parameters.every( (element, index) => element.equals(other.parameters[index]) );
  }
}

export class ZoomScreenCollection
{
  screens: Array<ZoomScreen> = new Array<ZoomScreen>();

  equals(other: ZoomScreenCollection | undefined, ignoreBlankScreens: boolean = false): boolean
  {
    if (other === undefined)
      return false;
    if (ignoreBlankScreens) {
      let thisIndex = 0;
      let otherIndex = 0;
      while (thisIndex < this.screens.length && otherIndex < other.screens.length) {
        let thisScreen = this.screens[thisIndex];
        let otherScreen = other.screens[otherIndex];

        // while (thisScreen.parameters.length === 0) {
        //   // parameters.length === 0 for a BPM device
        //   thisIndex++;
        //   thisScreen = this.screens[thisIndex];
        // }

        // while (otherScreen.parameters.length === 0) {
        //   // parameters.length === 0 for a BPM device
        //   otherIndex++;
        //   otherScreen = other.screens[otherIndex];
        // }

        while (thisScreen.parameters.length === 2 && thisScreen.parameters[1].name === "Blank" && thisIndex < this.screens.length) {
          thisIndex++;
          thisScreen = this.screens[thisIndex];
        }

        while (otherScreen.parameters.length === 2 && otherScreen.parameters[1].name === "Blank" && otherIndex < other.screens.length) {
          otherIndex++;
          otherScreen = other.screens[otherIndex];
        }

        if (thisIndex >= this.screens.length && otherIndex >= other.screens.length)
          return true;

        if (thisIndex >= this.screens.length  || otherIndex >= other.screens.length)
          return false; // one of them are at end of array, but not both


        if (!thisScreen.equals(otherScreen)) {
          return false;
        }

        thisIndex += 1;
        otherIndex += 1;
      }
      return true;
    }
    else
      return this.screens.length === other.screens.length && this.screens.every( (element, index) => element.equals(other.screens[index]) );
  }
  

  readString(data: Uint8Array, offset: number, length: number) : string | null
  {
    let str = "";
    if (data.length - offset < length)
      return null;

    for (let i=0; i<length; i++) {
      str += String.fromCharCode(data[offset + i]);
    }
    return str;
  }

  parseScreenData(data: Uint8Array, offset: number): number
  {
    while (offset < data.length - 1) {
      let screenNumber = data[offset]; offset += 1;
      let parameterNumber = data[offset]; offset += 1;
      let type = data[offset]; offset += 1;
      let invertByte = data[offset]; offset += 1;
      let str = this.readString(data, offset, 10); offset += 10;
      
      if (! (screenNumber in this.screens))
        this.screens[screenNumber] = new ZoomScreen();

      if (! (parameterNumber in this.screens[screenNumber].parameters))
        this.screens[screenNumber].parameters[parameterNumber] = new ZoomScreenParameter();

      if (invertByte !== 0) {
        shouldLog(LogLevel.Warning) && console.warn(`ZoomScreen.parseScreenData() the mysterious invertByte !== 0 for screen ${screenNumber}, parameter ${parameterNumber}, type ${type}, invertByte "${invertByte}", string: "${str}". Investigate.`);
      }

      if (str === null) {
        shouldLog(LogLevel.Error) && console.error(`ZoomScreen.parseScreenData() failed to read string for screen ${screenNumber}, parameter ${parameterNumber}, type ${type}, invertByte "${invertByte}"`);
        break;
      }
      
      str = str.replaceAll("\x00", ""); // strip trailing \x00

      // Observed types are 0, 1, 3, 7

      if ((type & 0b00000001) === 0) { // value
        this.screens[screenNumber].parameters[parameterNumber].valueString = str;
        this.screens[screenNumber].parameters[parameterNumber].valueType = type;
        this.screens[screenNumber].parameters[parameterNumber].valueInvertByte = invertByte;
      }
      else if ((type & 0b00000001) === 1) { // name, this is possibly a flag (bit 0), that could be combined with invert (bit 1 and 2)
        this.screens[screenNumber].parameters[parameterNumber].name = str;
        this.screens[screenNumber].parameters[parameterNumber].nameType = type;
        this.screens[screenNumber].parameters[parameterNumber].nameInvertByte = invertByte;
      }

      if ((type & 0b00000010) === 2) { // unknown flag, always set if bit 3 is set, but can also be set without bit 3 being set
        this.screens[screenNumber].parameters[parameterNumber].unknownFlag = true;
      }

      if ((type & 0b00000100) === 4) { // invert name. Invert is probably a flag indicated by bit 2 (and 1?) in the type byte, 4 + 2 + 1 (name) = 7
        this.screens[screenNumber].parameters[parameterNumber].invert = true;
      }

      if (type !== 0 && type !== 1 && type !== 3 && type !== 7)
        shouldLog(LogLevel.Warning) && console.warn(`ZoomScreen.parseScreenData() type "${type}" is unknown for screen ${screenNumber}, parameter ${parameterNumber}, invert byte "${invertByte}", string: "${str}". Investigate.`);
    }

    // If any screens are missing, insert empty screens
    // If a BPM module is inserted in the effect chain, the corresponding screen will be missing from the data
    for (let i = 0; i < this.screens.length; i++)
      if (this.screens[i] === undefined) {
        this.screens[i] = new ZoomScreen();
      }

    return offset;
  }
  
  setFromPatchAndMap(patch: ZoomPatch, effectsMap: Map<number, EffectParameterMap>) : ZoomScreenCollection | undefined
  {
    if (patch.effectSettings === null) {
      shouldLog(LogLevel.Error) && console.error(`patch.effectSettings == null for patch ${patch.name}`);
      return undefined;
    }

    let numEffects = patch.numEffects ?? patch.effectSettings.length;
    for (let effectSlot = 0; effectSlot< numEffects; effectSlot++) {
      let effectSettings = patch.effectSettings[effectSlot];
      if (effectSettings.id === 0) {
        shouldLog(LogLevel.Info) && console.log(`Ignoring effectSettings.id == 0 for effectSlot ${effectSlot} in patch ${patch.name}`);
        continue;
      }
      let effectMap = effectsMap.get(effectSettings.id);
      if (effectMap === undefined) {
        shouldLog(LogLevel.Error) && console.error(`Unable to find mapping for effect id ${numberToHexString(effectSettings.id)} in effectSlot ${effectSlot} in patch ${patch.name}`);
        return undefined;
      }

      let screen = new ZoomScreen();

      let parameter = new ZoomScreenParameter()
      parameter.name = "OnOff";
      parameter.valueString = effectSettings.enabled ? "1" : "0";
      screen.parameters.push(parameter);

      parameter = new ZoomScreenParameter()
      parameter.name = effectMap.name;
      parameter.valueString = effectMap.name;
      screen.parameters.push(parameter);

      let numParameters = effectMap.parameters.length;
      if (effectMap.parameters.length < effectSettings.parameters.length) {
        // shouldLog(LogLevel.Info) && console.log(`effectMap.parameters.length ${effectMap.parameters.length} < effectSettings.parameters.length ${effectSettings.parameters.length} for effect ${effectMap.name}`);
          // This is not an error. MSOG patches always contain 9 parameters. We will ignore the unused ones.
      } 
      else if (effectMap.parameters.length > effectSettings.parameters.length) {
        shouldLog(LogLevel.Warning) && console.warn(`effectMap.parameters.length ${effectMap.parameters.length} > effectSettings.parameters.length ${effectSettings.parameters.length} for effect ${effectMap.name}`);
      }

      for (let paramIndex = 0; paramIndex < effectMap.parameters.length; paramIndex++) {
        let value = effectSettings.parameters[paramIndex];
        let parameter = new ZoomScreenParameter()

        if (value >= effectMap.parameters[paramIndex].values.length) {
          shouldLog(LogLevel.Error) && console.error(`value ${value} >= effectMap.parameters[paramIndex].values.length ${effectMap.parameters[paramIndex].values.length} for effect ${effectMap.name}, parameterIndex ${paramIndex}`);
          break;
        }
        parameter.name = effectMap.parameters[paramIndex].name;
        parameter.valueString = effectMap.parameters[paramIndex].values[value];
        screen.parameters.push(parameter);
      }

      this.screens.push(screen);
    }
    return this;
  }

  setEffectParameterValue(patch: ZoomPatch, effectsMap: Map<number, EffectParameterMap>, effectSlot: number, parameterNumber: number, value: number) : void
  {
    if (effectSlot >= this.screens.length || parameterNumber >= this.screens[effectSlot].parameters.length) {
      shouldLog(LogLevel.Error) && console.error(`setEffectParameterValue() effectSlot ${effectSlot} or parameterNumber ${parameterNumber} out of range`);
      return;  
    }

    if (patch.effectSettings === null) {
      shouldLog(LogLevel.Error) && console.error(`patch.effectSettings == null for patch ${patch.name}`);
      return;
    }

    let effectSettings = patch.effectSettings[effectSlot];
    let effectMap = effectsMap.get(effectSettings.id);
    if (effectMap === undefined) {
      shouldLog(LogLevel.Error) && console.error(`Unable to find mapping for effect id ${numberToHexString(effectSettings.id)} in effectSlot ${effectSlot} in patch ${patch.name}`);
      return;
    }

    let screen = this.screens[effectSlot];
    let parameter = screen.parameters[parameterNumber];

    let valueString: string;

    if (parameterNumber === 0) {
      //valueString = value > 0 ? "ON" : "OFF";
      valueString = value > 0 ? "1" : "0";
    }
    else {
      let parameterIndex = parameterNumber - 2;
      valueString = effectMap.parameters[parameterIndex].values[value];
    }

    shouldLog(LogLevel.Info) && console.log(`Changing effect parameter value from "${parameter.valueString}" to "${valueString}" for effect ${effectMap.name}, parameter ${parameter.name}`);
    parameter.valueString = valueString;
 }
 
 deleteScreen(screenNumber: number) : void
 {
   if (screenNumber < 0 || screenNumber >= this.screens.length) {
     shouldLog(LogLevel.Error) && console.error(`screenNumber ${screenNumber} out of range`);
     return;  
   }
   
   this.screens.splice(screenNumber, 1);
 }

  static fromScreenData(data: Uint8Array, offset: number = 0) : ZoomScreenCollection 
  {
    let zoomScreenCollection = new ZoomScreenCollection();
    offset = zoomScreenCollection.parseScreenData(data, offset);
    return zoomScreenCollection;
  }

  static fromPatchAndMappings(patch: ZoomPatch, effectMap: Map<number, EffectParameterMap>) : ZoomScreenCollection | undefined
  {
    let zoomScreenCollection = new ZoomScreenCollection();
    return zoomScreenCollection.setFromPatchAndMap(patch, effectMap);
  }
}