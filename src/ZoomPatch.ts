import { getNumberFromBits, partialArrayMatch, partialArrayStringMatch } from "./tools.js";

export class EffectSettings
{
  enabled: boolean = false;
  id: number = 0;
  parameters: Array<number> = new Array<number>();
}

/**
 * 
 * 
 * @see https://github.com/mungewell/zoom-zt2/
 *      https://gnome.eu.org/index.php?title=Zoom_Patch_File
 *      https://gnome.eu.org/index.php?title=Zoom_Effect_File
 */

export class ZoomPatch
{
  // Derived properties
  name: null | string = null;

  // Toplevel chunk including header and subchunks
  PTCF: null | string = null;
  length: null | number = null;
  version: null | number = null;
  numEffects: null | number = null; 
  target: null | number = null;
  ptcfUnknown: null | Uint8Array = null; // 6 bytes
  shortName: null | string = null;
  ids: null | Uint32Array = null;

  // Unknown
  TXJ1: null | string = null; // 4 + 4 + txj1Length bytes
  txj1Length: null | number = null; // 4 bytes
  txj1DescriptionJapanese: null | Uint8Array = null; // txj1Length bytes

  // Description
  TXE1: null | string = null; // 4 + 4 + txe1Length bytes
  txe1Length: null | number = null; // 4 bytes
  txe1DescriptionEnglish: null | string = null; // txe1Length bytes

  EDTB: null | string = null; // 4 + 4 + numEffects * 24 bytes == 4 + 4 + edtbLength bytes
  edtbLength: null | number = null; // 4 bytes
  edtbReversedBytes: null | Array<Uint8Array> = null; // numEffects * 24 bytes == edtbLength bytes
  edtbEffectSettings: null | Array<EffectSettings> = null;

  PRM2: null | string = null; // 4 + 4 + prm2Length
  prm2Length: null | number = null; // 4 bytes
  prm2Tempo: null | number = null; // based on the two last bytes in prm2Unknown
  prm2EditEffectSlot: null | number = null; // based on byte 10, 11 and 12 in prm2Unknown
  prm2FirstSlotWithDrivePerhaps: null | number = null; // based on byte 20 in prm2Unknown
  prm2Unknown: null | Uint8Array = null; // prm2Length bytes

  NAME: null | string = null;
  nameLength: null | number = null; // 4 bytes
  longName: null | string = null; // 28 bytes == nameLength bytes. The last four characters are sometimes (always?) 0x00.

  // Zoom MS OriGinal pedal info below
  MSOG: null | string = null; // This is not a named chunk. The original MS pedals doesn't have a chunk-based layout but rather a fixed structure.
  msogEffectSettings: null | Array<EffectSettings> = null;
  msogEffectsReversedBytes: null | Array<Uint8Array> = null; // numEffects * 18 bytes
  msogUnknown1: null | Uint8Array = null; // 2 bytes
  msogUnknown2: null | Uint8Array = null; // 1 byte
  msogTempo: null | number = null; // 8 bits based on the last 2 bytes in msogUnknown1
  msogEditEffectSlot: null | number = null; // 3 bits based on the two first bytes in msogUnknown1
  msogDSPFullBits: null | number = null; // 6 bits based on the first byte in mspgUnknown1
  msogNumEffects: null | number = null; // 3 bits based on the second byte in mspgUnknown1
  // length: null | number = null;
  // version: null | number = null;
  // numEffects: null | number = null; 
  // target: null | number = null;
  // ptcfUnknown: null | Uint8Array = null; // 6 bytes
  // shortName: null | string = null;
  // ids: null | Uint32Array = null;

  readString(patch: Uint8Array, offset: number, length: number) : string | null
  {
    let str = "";
    if (patch.length - offset < length)
      return null;

    for (let i=0; i<length; i++) {
      str += String.fromCharCode(patch[offset + i]);
    }
    return str;
  }

  readInt32(patch: Uint8Array, offset: number) : number | null
  {
    if (patch.length - offset < 4)
      return null;

    return patch[offset] + (patch[offset + 1] << 8) + (patch[offset + 2] << 16) + (patch[offset + 3] << 24); 
  }

  readInt32Array(patch: Uint8Array, offset: number, length: number) : Uint32Array | null
  {
    if (patch.length - offset < length * 4)
      return null;

    let array = new Uint32Array(length);
    for (let i=0; i<length; i++) {
      let num = this.readInt32(patch, offset + i*4);
      if (num === null)
        return null;
      array[i] = num;
    }
 
    return array;
  }

  readPTCF(patch: Uint8Array, offset:number) : number
  {
    this.PTCF = this.readString(patch, offset, 4); offset +=4;
    this.length = this.readInt32(patch, offset); offset += 4;
    this.version = this.readInt32(patch, offset); offset += 4;
    this.numEffects = this.readInt32(patch, offset); offset += 4;
    this.target = this.readInt32(patch, offset); offset += 4;
    this.ptcfUnknown = patch.slice(offset, offset + 6); offset += 6;
    this.shortName = this.readString(patch, offset, 10); offset += 10;
    this.name = this.shortName;
    if (this.numEffects !== null) {
      this.ids = this.readInt32Array(patch, offset, this.numEffects);
      offset += this.numEffects * 4;
    }

    this.TXJ1 = this.readString(patch, offset, 4); offset +=4;
    this.txj1Length = this.readInt32(patch, offset); offset += 4;
    if (this.txj1Length != null && this.txj1Length > 0) {
      this.txj1DescriptionJapanese = patch.slice(offset, offset + this.txj1Length); offset += this.txj1Length;
    }

    this.TXE1 = this.readString(patch, offset, 4); offset +=4;
    this.txe1Length = this.readInt32(patch, offset); offset += 4;
    if (this.txe1Length != null && this.txe1Length > 0) {
      this.txe1DescriptionEnglish = this.readString(patch, offset, this.txe1Length); offset += this.txe1Length;
    }

    // EDTB chunk
    // Bit  # bits  Meanining
    //   0       1  Effect on/off
    //   1      29  Effect ID
    //  30      12  Parameter 0
    //  42      12  Parameter 1
    //  54      12  Parameter 2
    //  66      12  Parameter 3
    //  78      12  Parameter 4
    //  90       8  Parameter 5
    //  98       8  Parameter 6
    // 106       8  Parameter 7
    // 114       8  Parameter 8
    // 122       8  Parameter 9
    // 130       8  Parameter 10
    // 138       8  Parameter 11
    // 146       8  Parameter 12
    // 153          Last bit of parameter 12
    // Total 154 bits = 19 bytes. There are 5 bytes with unknown data after the parameters.
    if (this.numEffects !== null) {
      this.EDTB = this.readString(patch, offset, 4); offset +=4;
      this.edtbLength = this.readInt32(patch, offset); offset += 4;
      this.edtbReversedBytes = new Array<Uint8Array>(this.numEffects);
      this.edtbEffectSettings = new Array<EffectSettings>();
      for (let i=0; i<this.numEffects; i++) {
        this.edtbReversedBytes[i] = patch.slice(offset, offset + 24).reverse(); offset += 24;
        let bitpos = this.edtbReversedBytes[i].length * 8 - 1;
        let effectSettings = new EffectSettings();
        effectSettings.enabled = (getNumberFromBits(this.edtbReversedBytes[i], bitpos, bitpos) === 1); bitpos -= 1;
        effectSettings.id = getNumberFromBits(this.edtbReversedBytes[i], bitpos - 28, bitpos); bitpos -= 29; // One bit more than MS-50G
        effectSettings.parameters = new Array<number>();
        for (let p=0; p<5; p++) {
          let parameter = getNumberFromBits(this.edtbReversedBytes[i], bitpos - 11, bitpos); bitpos -= 12;
          effectSettings.parameters.push(parameter);
        }
        for (let p=5; p<12 && bitpos - 8 >= 0; p++) {
          let parameter = getNumberFromBits(this.edtbReversedBytes[i], bitpos - 7, bitpos); bitpos -= 8;
          effectSettings.parameters.push(parameter);
        }
        this.edtbEffectSettings.push(effectSettings);
      }
    }

    this.PRM2 = this.readString(patch, offset, 4); offset +=4;
    this.prm2Length = this.readInt32(patch, offset); offset += 4;
    if (this.prm2Length != null && this.prm2Length > 0) {
      this.prm2Unknown = patch.slice(offset, offset + this.prm2Length); offset += this.prm2Length;
      let tempo1 = this.prm2Unknown[this.prm2Unknown.length -2];
      let tempo2 = this.prm2Unknown[this.prm2Unknown.length -1];
      this.prm2Tempo = ((tempo1 & 0b11110000) >> 4) + ((tempo2 & 0b00001111) << 4);
      // FIXME: Read prm2EditEffectSlot, see description above
    }

    this.NAME = this.readString(patch, offset, 4); offset +=4;
    this.nameLength = this.readInt32(patch, offset); offset += 4;
    if (this.nameLength != null && this.nameLength > 0) {
      this.longName = this.readString(patch, offset, this.nameLength); offset += this.nameLength; 
      if (this.longName != null)
        this.longName = this.longName.replace(/\x00/g, ""); // The last four characters could be 0x00
      this.name = this.longName;
    }

    return offset;
  }

  // Byte  #bytes  Meaning
  //    0  108     Effect parameters, 6x18 bytes
  //  108    3     Unknown bytes
  //  111   10     Name
  //  121    1     Unknown byte
  readMSPatch(patch: Uint8Array, offset: number): number 
  {
    this.MSOG = "MSOG";
    this.length = patch.length - offset;
    this.numEffects = 6; // FIXME add support for other pedals, like MS-60B with 4 effects
    this.msogEffectsReversedBytes = new Array<Uint8Array>(this.numEffects);
    this.msogEffectSettings = new Array<EffectSettings>();
    this.ids = new Uint32Array(this.numEffects);
    for (let i=0; i<this.numEffects; i++) { // Each effect section is 18 bytes
      // P0 = 11 bits. P1 = 10 bits. P2 = 10 bits. P3-P5 = 8 bits
      this.msogEffectsReversedBytes[i] = patch.slice(offset, offset + 18).reverse(); offset += 18;
      let bitpos = this.msogEffectsReversedBytes[i].length * 8 - 1;
      let effectSettings = new EffectSettings();
      effectSettings.enabled = (getNumberFromBits(this.msogEffectsReversedBytes[i], bitpos, bitpos) === 1); bitpos -= 1;
      effectSettings.id = getNumberFromBits(this.msogEffectsReversedBytes[i], bitpos - 27, bitpos); bitpos -= 28; // One bit less than MS-50G+
      this.ids[i] = effectSettings.id;
      effectSettings.parameters = new Array<number>();

      // P0 = 13 bits. That's one more than for MS-50G+. Weird. Or is there one bit in there that we don't know what means?
      let parameter = getNumberFromBits(this.msogEffectsReversedBytes[i], bitpos - 12, bitpos); bitpos -= 13;
      effectSettings.parameters.push(parameter);
      // P1 = 13 bits
      parameter = getNumberFromBits(this.msogEffectsReversedBytes[i], bitpos - 12, bitpos); bitpos -= 13;
      effectSettings.parameters.push(parameter);
      // P2 = 13 bits
      parameter = getNumberFromBits(this.msogEffectsReversedBytes[i], bitpos - 12, bitpos); bitpos -= 13;
      effectSettings.parameters.push(parameter);
      // P3-P7 = 8 bits
      for (let p=3; p<8 && bitpos - 8 >= 0; p++) {
        parameter = getNumberFromBits(this.msogEffectsReversedBytes[i], bitpos - 7, bitpos); bitpos -= 8;
        effectSettings.parameters.push(parameter);
      }
      // P9 = 8 bits. It is oddly placed, and we don't know what the surrounding bits are (20 unknown bits before, 8 unknown bits after)
      // One byte is probably cab-related
      bitpos -= 20.
      parameter = getNumberFromBits(this.msogEffectsReversedBytes[i], bitpos - 7, bitpos); bitpos -= 8;
      effectSettings.parameters.push(parameter);

      this.msogEffectSettings.push(effectSettings);
    }

    this.msogUnknown1 = patch.slice(offset, offset + 3); offset += 3;

    this.msogTempo = ((this.msogUnknown1[1] & 0b11100000) >> 5) + ((this.msogUnknown1[2] & 0b00011111) << 3);

    this.msogEditEffectSlot = ((this.msogUnknown1[0] & 0b11000000) >> 6) + ((this.msogUnknown1[2] & 0b00000001) << 2);

    this.msogDSPFullBits = (this.msogUnknown1[0] & 0b00111111);

    this.msogNumEffects = (this.msogUnknown1[1] & 0b00011100) >> 2;
    // FIXME: Think through the difference between num effects used in a patch and the max number of effects for a device
    // we need to read 6 effects here to get the offsets right...

    this.shortName = this.readString(patch, offset, 10); offset += 10; 
    if (this.shortName != null)
      this.shortName = this.shortName.replace(/\x00/g, ""); // Safety guard against characters being 0
    this.name = this.shortName;

    this.msogUnknown2 = patch.slice(offset, offset + 1); offset += 1;

    // version: null | number = null;
    // numEffects: null | number = null; 
    // target: null | number = null;
    // ids: null | Uint32Array = null;
  
    return offset;
  }

  static fromPatchData(patch: Uint8Array, offset: number = 0) : ZoomPatch 
  {
    let zoomPatch = new ZoomPatch();
    if (partialArrayStringMatch(patch, "PTCF"))
      offset = zoomPatch.readPTCF(patch, offset);
    else
      offset = zoomPatch.readMSPatch(patch, offset);
    return zoomPatch;
  }
}