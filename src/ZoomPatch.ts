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
  length: null | number = null; // NB! This length includes the 4 byte ID and the 4 byte length value, in other words it is the total patch length starting from the P in PTCF. This is different from the chunk lengths below, which does not include these 8 bytes.
  version: null | number = null;
  numEffects: null | number = null; 
  target: null | number = null;
  ptcfUnknown: null | Uint8Array = null; // 6 bytes
  shortName: null | string = null;
  ids: null | Uint32Array = null;
  
  ptcfChunk: null | Uint8Array = null; // Raw unparsed PTCF chunk, including the "PTCF" ID and 4 bytes for the length value
  chunks: Map<string, Uint8Array> = new Map<string, Uint8Array>(); // Raw unparsed chunks

  // Unknown
  TXJ1: null | string = null; // 4 + 4 + txj1Length bytes
  txj1Length: null | number = null; // 4 bytes, chunk length does not include the length of the ID (4 bytes) and length bytes (4 bytes) itself 
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
  msogDataBuffer: null | Uint8Array = null; // Complete 8-bit data buffer for the patch

  get nameTrimmed(): string | null
  {
    return this.name === null ? null : this.name.trim().replace(/[ ]{2,}/gi," ");
  }

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

  readPTCFChunks(patch: Uint8Array, offset:number, remainingPatchLength: number) : number
  {
    let maxChunkLength = 10000000;
    let chunkID: string | null;
    let chunkLength: number | null;
    let chunkData: Uint8Array | null;

    let initialOffset = offset;

    if (this.length === null) {
      console.warn(`ZoomPatch.readPTCFChunks() this.length === null`)
      return offset;
    }

    while (offset - initialOffset < remainingPatchLength) {

      if (offset - initialOffset + 8 > remainingPatchLength) {
        console.warn(`ZoomPatch.readPTCFChunks() individual chunk lengths do not match total PTCF chunk length`)
        break;
      }

      chunkID = this.readString(patch, offset, 4); offset +=4;

      if (chunkID === null) {
        console.warn(`ZoomPatch.readPTCFChunks() failed to read chunk ID from data`)
        break;
      }
  
      chunkLength = this.readInt32(patch, offset); offset += 4;
      if (chunkLength === null) {
        console.warn(`ZoomPatch.readPTCFChunks() failed to read chunk length for chunk with ID "${chunkID}"`)
        break;
      }
      if (chunkLength < 0 || chunkLength > maxChunkLength) {
        console.warn(`ZoomPatch.readPTCFChunks() Invalid chunk length (${chunkLength}) for chunk "${chunkID}", maxChunkLength = ${maxChunkLength}`)
        break;
      }
      if (offset - initialOffset + chunkLength > this.length) {
        console.warn(`ZoomPatch.readPTCFChunks() offset (${offset}) - initialOffset (${initialOffset}) + chunk length (${chunkLength}) > total patch length (${this.length}) for chunk with ID "${chunkID}"`)
        break;
      }

      chunkData = patch.slice(offset, offset + chunkLength); offset += chunkLength;

      if (this.chunks.has(chunkID)) {
        console.warn(`ZoomPatch.readPTCFChunks() duplicate chunk ID "${chunkID}" in patch data`)
        break;
      }

      this.chunks.set(chunkID, chunkData);
    }

    return offset;
  }

  readPTCF(data: Uint8Array, offset:number) : number
  {
    let ptcfChunkStart = offset;

    if (data.length - offset < 8) {
      console.warn(`ZoomPatch.readPTCFChunks() got patch data with no space for chunks after offset - patch.length = ${data.length}, offset = ${offset}`)
      return offset;
    }
    
    const initialDataOffset = offset;

    this.PTCF = this.readString(data, offset, 4); offset +=4;
    if (this.PTCF !== "PTCF") {
      console.warn(`ZoomPatch.readPTCFChunks() got patch data that doesn't start with ID "PTCF" - ID = ${this.PTCF}`)
      return offset;
    }

    this.length = this.readInt32(data, offset); offset += 4;
    if (this.length === null || this.length > data.length - initialDataOffset) {
      console.warn(`ZoomPatch.readPTCFChunks() PTCF chunk length (${this.length}) is greater than patch length (${data.length}) - offset (${offset})`)
      return offset;
    }

    this.ptcfChunk = data.slice(ptcfChunkStart, ptcfChunkStart + this.length);

    const initialOffset = offset;

    this.version = this.readInt32(data, offset); offset += 4;
    this.numEffects = this.readInt32(data, offset); offset += 4;
    this.target = this.readInt32(data, offset); offset += 4;
    this.ptcfUnknown = data.slice(offset, offset + 6); offset += 6;
    this.shortName = this.readString(data, offset, 10); offset += 10;
    this.name = this.shortName;

    if (this.numEffects !== null) {
      this.ids = this.readInt32Array(data, offset, this.numEffects);
      offset += this.numEffects * 4;
    }

    const lengthOfPTCFIDAndLengthBytes = 4 + 4;
    offset = this.readPTCFChunks(data, offset, this.length - lengthOfPTCFIDAndLengthBytes - (offset - initialOffset));

    if (offset - initialOffset != this.length - lengthOfPTCFIDAndLengthBytes) {
      console.warn(`ZoomPatch.readPTCF() offset mismatch after reading chunks. offset (${offset}) - initialOffset (${initialOffset}) != total PTCF chunk length (${this.length})`);
    }

    let chunkData: Uint8Array | undefined;
    let chunkID: string;
    let chunkOffset: number;

    chunkID = "TXJ1";
    chunkData = this.chunks.get(chunkID);
    if (chunkData === undefined) {
      console.warn(`ZoomPatch.readPTCF() chunk ID "${chunkID} not found in patch data - this.chunks.size = ${this.chunks.size}`);
    }
    else {
      chunkOffset = 0;
      this.TXJ1 = chunkID;
      this.txj1Length = chunkData.length;
      if (this.txj1Length != null && this.txj1Length > 0) {
        this.txj1DescriptionJapanese = chunkData.slice(chunkOffset, chunkOffset + this.txj1Length); chunkOffset += this.txj1Length;
      }
    }

    chunkID = "TXE1";
    chunkData = this.chunks.get(chunkID);
    if (chunkData === undefined) {
      console.warn(`ZoomPatch.readPTCF() chunk ID "${chunkID} not found in patch data - this.chunks.size = ${this.chunks.size}`);
    }
    else {
      chunkOffset = 0;
      this.TXE1 = chunkID;
      this.txe1Length = chunkData.length;
      if (this.txe1Length != null && this.txe1Length > 0) {
        this.txe1DescriptionEnglish = this.readString(chunkData, chunkOffset, this.txe1Length); chunkOffset += this.txe1Length;
      }
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
    chunkID = "EDTB";
    chunkData = this.chunks.get(chunkID);
    if (chunkData === undefined) {
      console.warn(`ZoomPatch.readPTCF() chunk ID "${chunkID} not found in patch data - this.chunks.size = ${this.chunks.size}`);
    }
    else {
      chunkOffset = 0;
      this.EDTB = chunkID;
      this.edtbLength = chunkData.length;
      if (this.numEffects === null) {
        console.warn(`ZoomPatch.readPTCF() this.numEffects === null, but EDTB chunk has length ${chunkData.length}`);
      }
      else {
        this.edtbReversedBytes = new Array<Uint8Array>(this.numEffects);
        this.edtbEffectSettings = new Array<EffectSettings>();
        for (let i=0; i<this.numEffects; i++) {
          this.edtbReversedBytes[i] = chunkData.slice(chunkOffset, chunkOffset + 24).reverse(); chunkOffset += 24;
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
    }

    chunkID = "PRM2";
    chunkData = this.chunks.get(chunkID);
    if (chunkData === undefined) {
      console.warn(`ZoomPatch.readPTCF() chunk ID "${chunkID} not found in patch data - this.chunks.size = ${this.chunks.size}`);
    }
    else {
      chunkOffset = 0;
      this.PRM2 = chunkID;
      this.prm2Length = chunkData.length;
      if (this.prm2Length != null && this.prm2Length > 0) {
        this.prm2Unknown = chunkData.slice(chunkOffset, chunkOffset + this.prm2Length); chunkOffset += this.prm2Length;
        let tempo1 = this.prm2Unknown[this.prm2Unknown.length -2];
        let tempo2 = this.prm2Unknown[this.prm2Unknown.length -1];
        this.prm2Tempo = ((tempo1 & 0b11110000) >> 4) + ((tempo2 & 0b00001111) << 4);
        // FIXME: Read prm2EditEffectSlot, see description above
      }
    }

    chunkID = "NAME";
    chunkData = this.chunks.get(chunkID);
    if (chunkData === undefined) {
      console.warn(`ZoomPatch.readPTCF() chunk ID "${chunkID} not found in patch data - this.chunks.size = ${this.chunks.size}`);
    }
    else {
      chunkOffset = 0;
      this.NAME = chunkID;
      this.nameLength = chunkData.length;
      if (this.nameLength != null && this.nameLength > 0) {
        this.longName = this.readString(chunkData, chunkOffset, this.nameLength); chunkOffset += this.nameLength; 
        if (this.longName != null)
          this.longName = this.longName.replace(/\x00/g, ""); // The last four characters could be 0x00
        this.name = this.longName;
      }
    }

    return offset;
  }

  readPTCFFixedDeprecated(data: Uint8Array, offset:number) : number
  {
    this.PTCF = this.readString(data, offset, 4); offset +=4;
    this.length = this.readInt32(data, offset); offset += 4;
    this.version = this.readInt32(data, offset); offset += 4;
    this.numEffects = this.readInt32(data, offset); offset += 4;
    this.target = this.readInt32(data, offset); offset += 4;
    this.ptcfUnknown = data.slice(offset, offset + 6); offset += 6;
    this.shortName = this.readString(data, offset, 10); offset += 10;
    this.name = this.shortName;
    if (this.numEffects !== null) {
      this.ids = this.readInt32Array(data, offset, this.numEffects);
      offset += this.numEffects * 4;
    }

    this.TXJ1 = this.readString(data, offset, 4); offset +=4;
    this.txj1Length = this.readInt32(data, offset); offset += 4;
    if (this.txj1Length != null && this.txj1Length > 0) {
      this.txj1DescriptionJapanese = data.slice(offset, offset + this.txj1Length); offset += this.txj1Length;
    }

    this.TXE1 = this.readString(data, offset, 4); offset +=4;
    this.txe1Length = this.readInt32(data, offset); offset += 4;
    if (this.txe1Length != null && this.txe1Length > 0) {
      this.txe1DescriptionEnglish = this.readString(data, offset, this.txe1Length); offset += this.txe1Length;
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
      this.EDTB = this.readString(data, offset, 4); offset +=4;
      this.edtbLength = this.readInt32(data, offset); offset += 4;
      this.edtbReversedBytes = new Array<Uint8Array>(this.numEffects);
      this.edtbEffectSettings = new Array<EffectSettings>();
      for (let i=0; i<this.numEffects; i++) {
        this.edtbReversedBytes[i] = data.slice(offset, offset + 24).reverse(); offset += 24;
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

    this.PRM2 = this.readString(data, offset, 4); offset +=4;
    this.prm2Length = this.readInt32(data, offset); offset += 4;
    if (this.prm2Length != null && this.prm2Length > 0) {
      this.prm2Unknown = data.slice(offset, offset + this.prm2Length); offset += this.prm2Length;
      let tempo1 = this.prm2Unknown[this.prm2Unknown.length -2];
      let tempo2 = this.prm2Unknown[this.prm2Unknown.length -1];
      this.prm2Tempo = ((tempo1 & 0b11110000) >> 4) + ((tempo2 & 0b00001111) << 4);
      // FIXME: Read prm2EditEffectSlot, see description above
    }

    this.NAME = this.readString(data, offset, 4); offset +=4;
    this.nameLength = this.readInt32(data, offset); offset += 4;
    if (this.nameLength != null && this.nameLength > 0) {
      this.longName = this.readString(data, offset, this.nameLength); offset += this.nameLength; 
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
  readMSPatch(data: Uint8Array, offset: number): number 
  {
    this.MSOG = "MSOG";
    this.msogDataBuffer = data.slice(offset, data.length);
    this.length = data.length - offset;
    this.numEffects = 6; // FIXME add support for other pedals, like MS-60B with 4 effects
    this.msogEffectsReversedBytes = new Array<Uint8Array>(this.numEffects);
    this.msogEffectSettings = new Array<EffectSettings>();
    this.ids = new Uint32Array(this.numEffects);
    for (let i=0; i<this.numEffects; i++) { // Each effect section is 18 bytes
      // P0 = 13 bits. P1 = 13 bits. P2 = 13 bits. P3-P8 = 8 bits
      this.msogEffectsReversedBytes[i] = data.slice(offset, offset + 18).reverse(); offset += 18;
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
      // P8 = 8 bits. It is oddly placed, and we don't know what the surrounding bits are (20 unknown bits before, 8 unknown bits after)
      // One byte is probably cab-related
      // FIXME: Store unknown bytes in effectSettings
      bitpos -= 20.
      parameter = getNumberFromBits(this.msogEffectsReversedBytes[i], bitpos - 7, bitpos); bitpos -= 8;
      effectSettings.parameters.push(parameter);

      this.msogEffectSettings.push(effectSettings);
    }

    this.msogUnknown1 = data.slice(offset, offset + 3); offset += 3;

    this.msogTempo = ((this.msogUnknown1[1] & 0b11100000) >> 5) + ((this.msogUnknown1[2] & 0b00011111) << 3);

    this.msogEditEffectSlot = ((this.msogUnknown1[0] & 0b11000000) >> 6) + ((this.msogUnknown1[2] & 0b00000001) << 2);

    this.msogDSPFullBits = (this.msogUnknown1[0] & 0b00111111);

    this.msogNumEffects = (this.msogUnknown1[1] & 0b00011100) >> 2;
    // FIXME: Think through the difference between num effects used in a patch and the max number of effects for a device
    // we need to read 6 effects here to get the offsets right...

    this.shortName = this.readString(data, offset, 10); offset += 10; 
    if (this.shortName != null)
      this.shortName = this.shortName.replace(/\x00/g, ""); // Safety guard against characters being 0
    this.name = this.shortName;

    this.msogUnknown2 = data.slice(offset, offset + 1); offset += 1;

    // tempo
    // dsp full
    // max effect number (numEffects?)

    // version: null | number = null;
    // numEffects: null | number = null; 
    // target: null | number = null;
    // ids: null | Uint32Array = null;
  
    return offset;
  }

  public static fromPatchData(data: Uint8Array, offset: number = 0) : ZoomPatch 
  {
    let zoomPatch = new ZoomPatch();
    if (partialArrayStringMatch(data, "PTCF"))
      offset = zoomPatch.readPTCF(data, offset);
    else
      offset = zoomPatch.readMSPatch(data, offset);
    return zoomPatch;
  }
}