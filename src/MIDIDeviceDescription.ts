export class MIDIDeviceDescription
{
  public readonly inputID: string = "";
  public readonly inputName: string = ""; 
  public readonly outputID: string = "";
  public readonly outputName: string = "";
  public readonly isInput: boolean = false;
  public readonly isOutput: boolean = false;
  public readonly manufacturerID: [number] | [number, number, number] = [0];
  public readonly manufacturerName: string = "unknown";
  public readonly familyCode: [number, number] = [0, 0];
  public readonly modelNumber: [number, number] = [0, 0];
  public readonly deviceName: string = "unknown"; // deduced from manufacturerID, familyCode and modelNumber
  public readonly versionNumber: [number, number, number, number] = [0, 0, 0, 0];
  public readonly identityResponse: Uint8Array = new Uint8Array();

  constructor(data: Partial<MIDIDeviceDescription>)
  {
    Object.assign(this, data);
  }
}
