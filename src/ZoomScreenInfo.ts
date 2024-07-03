

export class ZoomScreenParameter
{
  name: string = "";
  valueString: string = "";
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
      let unknown = data[offset]; offset += 1;
      let str = this.readString(data, offset, 10); offset += 10;
      
      if (! (screenNumber in this.screens))
        this.screens[screenNumber] = new ZoomScreen();

      if (! (parameterNumber in this.screens[screenNumber].parameters))
        this.screens[screenNumber].parameters[parameterNumber] = new ZoomScreenParameter();

      if (str === null) {
        console.warn(`ZoomScreen.parseScreenData() failed to read string for screen ${screenNumber}, parameter ${parameterNumber}, type ${type}, unknown byte "${unknown}"`);
        break;
      }
      
      str = str.replace(/\x00/g, ""); // strip trailing \x00

      if (type === 0) // value
        this.screens[screenNumber].parameters[parameterNumber].valueString = str;
      else if (type === 1) // name
        this.screens[screenNumber].parameters[parameterNumber].name = str;
      else 
        console.warn(`ZoomScreen.parseScreenData() type "${type}" is unknown for screen ${screenNumber}, parameter ${parameterNumber}, unknown byte "${unknown}"`);
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