

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

  equals(other: ZoomScreenCollection | undefined): boolean
  {
    return other !== undefined && this.screens.length === other.screens.length && this.screens.every( (element, index) => element.equals(other.screens[index]) );
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
        console.warn(`ZoomScreen.parseScreenData() the mysterious invertByte !== 0 for screen ${screenNumber}, parameter ${parameterNumber}, type ${type}, invertByte "${invertByte}", string: "${str}". Investigate.`);
      }

      if (str === null) {
        console.error(`ZoomScreen.parseScreenData() failed to read string for screen ${screenNumber}, parameter ${parameterNumber}, type ${type}, invertByte "${invertByte}"`);
        break;
      }
      
      str = str.replace(/\x00/g, ""); // strip trailing \x00

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
        console.warn(`ZoomScreen.parseScreenData() type "${type}" is unknown for screen ${screenNumber}, parameter ${parameterNumber}, invert byte "${invertByte}", string: "${str}". Investigate.`);
    }

    // If any screens are missing, insert empty screens
    // If a BPM module is inserted in the effect chain, the corresponding screen will be missing from the data
    for (let i = 0; i < this.screens.length; i++)
      if (this.screens[i] === undefined) {
        this.screens[i] = new ZoomScreen();
      }

    return offset;
  } 
 
  static fromScreenData(data: Uint8Array, offset: number = 0) : ZoomScreenCollection 
  {
    let zoomScreenCollection = new ZoomScreenCollection();
    offset = zoomScreenCollection.parseScreenData(data, offset);
    return zoomScreenCollection;
  }
}