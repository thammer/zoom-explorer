import { shouldLog, LogLevel } from "./Logger.js";
import { compareBuffers, getNumberFromBits, partialArrayMatch, partialArrayStringMatch, setBitsFromNumber } from "./tools.js";

/**
 * Settings for one effect slot in a Zoom patch.
 */
export class EffectSettings
{
  enabled: boolean = false;
  id: number = 0;
  parameters: Array<number> = new Array<number>();

  clone() : EffectSettings
  {
    let settings = new EffectSettings();
    settings.enabled = this.enabled;
    settings.id = this.id;
    settings.parameters = Array.from(this.parameters);
    return settings;
  }

  setFrom(other: EffectSettings)
  {
    this.enabled = other.enabled;
    this.id = other.id;
    this.parameters = Array.from(other.parameters);
  }

  static from(other: EffectSettings)
  {
    let settings = new EffectSettings();
    settings.setFrom(other);
    return settings;
  }
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

  // derived properties
  _name: string = "";
  maxNameLength: number = 0;
  descriptionEnglish: string = "";
  tempo: number = 0;
  currentEffectSlot: number = 0;
  
  updateDerivedPropertiesFromPatchProperties()
  {
    if (this.nameName !== null)
      this.name = this.nameName;
    else if (this.ptcfShortName !== null)
      this.name = this.ptcfShortName;
    else if (this.msogName !== null)
      this.name = this.msogName;
    else
      this.name = "";
  
    this.descriptionEnglish = this.txe1DescriptionEnglish !== null ? this.txe1DescriptionEnglish.replaceAll("\x00", "") : "";

    this.tempo = this.prm2Tempo !== null ? this.prm2Tempo : this.msogTempo !== null ? this.msogTempo : 0;

    this.currentEffectSlot = this.prm2EditEffectSlot !== null ? this.prm2EditEffectSlot : this.msogEditEffectSlot !== null ? this.msogEditEffectSlot : 0;
  }

  updatePatchPropertiesFromDerivedProperties()
  {
    if (this.NAME !== null) {
      // For MS Plus pedals, name is always 32 bytes, 28 bytes of ascii and four bytes of zero
      if (this.maxNameLength == 28) {
        let enforceLength = this.maxNameLength + 4;
        this.nameName = this.name.slice(0, Math.min(this.name.length, enforceLength)).padEnd(enforceLength - 4, " ").padEnd(enforceLength, String.fromCharCode(0x00));
        this.nameLength = this.nameName.length;
      }
      else {
        // this.name.length is enforced in this.name setter
        this.nameName = this.name;
      }
    }
    if (this.PTCF !== null)
      this.ptcfShortName = this.name.slice(0, Math.min(this.name.length, 10)).padEnd(10, " "); // length should be 10, padded with spaces at the end;
    if (this.MSOG !== null)
      this.msogName = this.name.slice(0, Math.min(this.name.length, 10)).padEnd(10, " "); // length should be 10, padded with spaces at the end

    if (this.TXE1 !== null) {
      this.txe1DescriptionEnglish = this.descriptionEnglish.padEnd(Math.ceil(this.descriptionEnglish.length / 4)*4, String.fromCharCode(0x00)); // length should be multiple of 4, padded with zeros
      this.txe1Length = this.txe1DescriptionEnglish.length;
    }

    if (this.PRM2 !== null)
      this.prm2Tempo = this.tempo;
    else if (this.msogTempo !== null)
      this.msogTempo = this.tempo;

    if (this.prm2EditEffectSlot !== null)
      this.prm2EditEffectSlot = this.currentEffectSlot;
    else if (this.msogEditEffectSlot !== null)
      this.msogEditEffectSlot = this.currentEffectSlot;
  }

  get name(): string
  {
    return this._name;
  }

  set name(name: string)
  {
    this._name = name.slice(0, Math.min(name.length, this.maxNameLength));
  }

  get nameTrimmed(): string
  {
    return this.name.trim().replace(/[ ]{2,}/gi," ");  // trim spaces at start and end, as well as double spaces
  }

  get descriptionEnglishTrimmed(): null | string
  {
    return this.descriptionEnglish.trim().replace(/[ ]{2,}/gi," ");  // trim spaces at start and end, as well as double spaces
  }

  /**
   * Get the effect settings for each effect slot.
   *
   * @return {null | Array<EffectSettings>} The effect settings array or null if no settings are available.
   */
  get effectSettings(): null | Array<EffectSettings>
  {
    if (this.edtbEffectSettings !== null)
      return this.edtbEffectSettings;
    else if (this.msogEffectSettings !== null)
      return this.msogEffectSettings;
    else
      return null;
  }

  // Toplevel chunk including header and subchunks
  PTCF: null | string = null;
  length: null | number = null; // NB! This length includes the 4 byte ID and the 4 byte length value, in other words it is the total patch length starting from the P in PTCF. This is different from the chunk lengths below, which does not include these 8 bytes.
  version: null | number = null;
  numEffects: null | number = null; 
  maxNumEffects: number = 0; 
  target: null | number = null;
  ptcfUnknown: null | Uint8Array = null; // 6 bytes
  ptcfShortName: null | string = null; // For patches delivered with MS+ pedals, this is always the 10 first characters of nameName
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
  nameName: null | string = null; // 28 bytes == nameLength bytes. The last four characters are sometimes (always?) 0x00.

  // Zoom MS OriGinal pedal info below
  MSOG: null | string = null; // This is not a named chunk. The original MS pedals doesn't have a chunk-based layout but rather a fixed structure.
  msogEffectSettings: null | Array<EffectSettings> = null;
  msogEffectsReversedBytes: null | Array<Uint8Array> = null; // numEffects * 18 bytes
  msogUnknown1: null | Uint8Array = null; // 3 bytes
  msogName: null | string = null; // 10 bytes
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

  clone(): ZoomPatch
  {
    let patch = new ZoomPatch();

    Object.getOwnPropertyDescriptors
    let properties: string[] = Object.getOwnPropertyNames(this);
    for (let i=0; i<properties.length; i++) {
      let propertyName: string = properties[i];
      let property = (this as any)[propertyName];
      // shouldLog(LogLevel.Info) && console.log(`Property name: "${propertyName}", : "${property?.constructor?.name}"`);
      if (property === null)
        (patch as any)[propertyName] = null;
      else if (propertyName === "chunks") {
        let clonedMap = (patch as any)[propertyName];
        property.forEach( (chunkBytes: Uint8Array, chunkName: string) => clonedMap.set(chunkName, new Uint8Array(chunkBytes)));        
      } 
      else if (property.constructor.name === "Array") {
        if (property[0].constructor.name === "Uint8Array")
          (patch as any)[propertyName] = Array.from(property, (e, i) => new Uint8Array(e as Uint8Array));  
        else if (property[0].constructor.name === "EffectSettings")
          (patch as any)[propertyName] = Array.from(property, (e, i) => (e as EffectSettings).clone());  
      }
      else if (property.constructor.name === "Uint32Array")
        (patch as any)[propertyName] = new Uint32Array(property); 
      else if (property.constructor.name === "Uint8Array")
        (patch as any)[propertyName] = new Uint8Array(property);
      else
        (patch as any)[propertyName] = property; 
    }

    shouldLog(LogLevel.Info) && console.log(`**** Cloned patch ${patch.name}`);
    return patch;
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

  writeString(data:Uint8Array, offset: number, str: string, enforceBufferLength: number = -1): number
  {
    if (enforceBufferLength == -1)
      enforceBufferLength = str.length;

    if (offset + enforceBufferLength > data.length) {
      shouldLog(LogLevel.Error) && console.error(`Not enough space in data buffer for the given string ("${str}"). data.length = ${data.length}, offset = ${offset}, str.length = ${str.length}, enforceBufferLength = ${enforceBufferLength}`);
      return 0;
    }

    if (str.length > enforceBufferLength) {
      shouldLog(LogLevel.Error) && console.error(`String length > enforceBufferLength. str.length = ${str.length}, enforceBufferLength = ${enforceBufferLength}`);
      return 0;
    }

    for (let i=0; i<enforceBufferLength; i++)
      data[offset + i] = (i < str.length) ? (str.charCodeAt(i) & 0b01111111) : 0;

    return offset + enforceBufferLength;
  }

  readInt32(patch: Uint8Array, offset: number) : number | null
  {
    if (patch.length - offset < 4)
      return null;

    return patch[offset] + (patch[offset + 1] << 8) + (patch[offset + 2] << 16) + (patch[offset + 3] << 24); 
  }

  writeInt32(data: Uint8Array, offset: number, int: number): number
  {
    if (offset + 4 > data.length) {
      shouldLog(LogLevel.Error) && console.error(`Not enough space in data buffer to store 32 bit int ("${int}"). data.length = ${data.length}, offset = ${offset}, bytes needed = 4`);
      return 0;
    }
    data[offset] = int & 0x000000FF;
    data[offset + 1] = (int & 0x0000FF00) >> 8;
    data[offset + 2] = (int & 0x00FF0000) >> 16;
    data[offset + 3] = (int & 0xFF000000) >> 24;

    return offset + 4;
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

  writeInt32Array(data: Uint8Array, offset: number, array: Uint32Array) : number
  {
    if (offset + array.length > data.length) {
      shouldLog(LogLevel.Error) && console.error(`Not enough space in data buffer to store Int32 array. data.length = ${data.length}, offset = ${offset}, array.length = ${array.length}`);
      return 0;
    }

    for (let i=0; i<array.length; i++) {
      let result = this.writeInt32(data, offset, array[i]);
      if (result === 0) {
        shouldLog(LogLevel.Error) && console.error(`Storing Int32 array failed. data.length = ${data.length}, offset = ${offset}, array.length = ${array.length}`);
        return 0;
      }
      offset = result;
    }

    return offset;
  }

  writeSlice(data: Uint8Array, offset: number, slice: Uint8Array) : number
  {
    if (offset + slice.length > data.length) {
      shouldLog(LogLevel.Error) && console.error(`Not enough space in data buffer to store slice. data.length = ${data.length}, offset = ${offset}, slice.length = ${slice.length}`);
      return 0;
    }

    data.set(slice, offset);

    return offset + slice.length;
  }

  readPTCFChunks(patch: Uint8Array, offset:number, remainingPatchLength: number) : number
  {
    let maxChunkLength = 10000000;
    let chunkID: string | null;
    let chunkLength: number | null;
    let chunkData: Uint8Array | null;

    let initialOffset = offset;

    if (this.length === null) {
      shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCFChunks() this.length === null`)
      return offset;
    }

    while (offset - initialOffset < remainingPatchLength) {

      if (offset - initialOffset + 8 > remainingPatchLength) {
        shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCFChunks() individual chunk lengths do not match total PTCF chunk length`)
        break;
      }

      chunkID = this.readString(patch, offset, 4); offset +=4;

      if (chunkID === null) {
        shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCFChunks() failed to read chunk ID from data`)
        break;
      }
  
      chunkLength = this.readInt32(patch, offset); offset += 4;
      if (chunkLength === null) {
        shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCFChunks() failed to read chunk length for chunk with ID "${chunkID}"`)
        break;
      }
      if (chunkLength < 0 || chunkLength > maxChunkLength) {
        shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCFChunks() Invalid chunk length (${chunkLength}) for chunk "${chunkID}", maxChunkLength = ${maxChunkLength}`)
        break;
      }
      if (offset - initialOffset + chunkLength > this.length) {
        shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCFChunks() offset (${offset}) - initialOffset (${initialOffset}) + chunk length (${chunkLength}) > total patch length (${this.length}) for chunk with ID "${chunkID}"`)
        break;
      }

      chunkData = patch.slice(offset, offset + chunkLength); offset += chunkLength;

      if (this.chunks.has(chunkID)) {
        shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCFChunks() duplicate chunk ID "${chunkID}" in patch data`)
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
      shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCFChunks() got patch data with no space for chunks after offset - patch.length = ${data.length}, offset = ${offset}`)
      return offset;
    }
    
    const initialDataOffset = offset;

    this.PTCF = this.readString(data, offset, 4); offset +=4;
    if (this.PTCF !== "PTCF") {
      shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCFChunks() got patch data that doesn't start with ID "PTCF" - ID = ${this.PTCF}`)
      return offset;
    }

    this.length = this.readInt32(data, offset); offset += 4;
    if (this.length === null || this.length > data.length - initialDataOffset) {
      shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCFChunks() PTCF chunk length (${this.length}) is greater than patch length (${data.length}) - offset (${offset})`)
      return offset;
    }

    this.ptcfChunk = data.slice(ptcfChunkStart, ptcfChunkStart + this.length);

    const initialOffset = offset;

    this.version = this.readInt32(data, offset); offset += 4;
    this.numEffects = this.readInt32(data, offset); offset += 4;
    this.target = this.readInt32(data, offset); offset += 4;
    this.ptcfUnknown = data.slice(offset, offset + 6); offset += 6;
    this.ptcfShortName = this.readString(data, offset, 10); offset += 10;
    this.maxNameLength = 10; // if NAME chunk is found, this will be changed below

    if (this.numEffects !== null) {
      this.ids = this.readInt32Array(data, offset, this.numEffects);
      offset += this.numEffects * 4;
    }

    const lengthOfPTCFIDAndLengthBytes = 4 + 4;
    offset = this.readPTCFChunks(data, offset, this.length - lengthOfPTCFIDAndLengthBytes - (offset - initialOffset));

    if (offset - initialOffset != this.length - lengthOfPTCFIDAndLengthBytes) {
      shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCF() offset mismatch after reading chunks. offset (${offset}) - initialOffset (${initialOffset}) != total PTCF chunk length (${this.length})`);
    }

    let chunkData: Uint8Array | undefined;
    let chunkID: string;
    let chunkOffset: number;

    chunkID = "TXJ1";
    chunkData = this.chunks.get(chunkID);
    if (chunkData === undefined) {
      shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCF() chunk ID "${chunkID} not found in patch data - this.chunks.size = ${this.chunks.size}`);
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
      shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCF() chunk ID "${chunkID} not found in patch data - this.chunks.size = ${this.chunks.size}`);
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
    // 114      12  Parameter 8
    // 126      12  Parameter 9   - 8 bits are verified, unknown if 8 or 12 bits
    // 138      12  Parameter 10  - not verified
    // 150      12  Parameter 11  - not verified
    // 161          Last bit of parameter 11 - not verified
    // Total verified 134 bits = 16 bytes and 6 bits. There are (24 - 16.6) 7 bytes and 2 bits of unknown data after the parameters.
    chunkID = "EDTB";
    chunkData = this.chunks.get(chunkID);
    if (chunkData === undefined) {
      shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCF() chunk ID "${chunkID} not found in patch data - this.chunks.size = ${this.chunks.size}`);
    }
    else {
      chunkOffset = 0;
      this.EDTB = chunkID;
      this.edtbLength = chunkData.length;
      if (this.numEffects === null) {
        shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCF() this.numEffects === null, but EDTB chunk has length ${chunkData.length}`);
      }
      else {
        this.edtbReversedBytes = new Array<Uint8Array>(this.numEffects);
        this.edtbEffectSettings = new Array<EffectSettings>();
        for (let i=0; i<this.numEffects; i++) {
          this.edtbReversedBytes[i] = chunkData.slice(chunkOffset, chunkOffset + 24).reverse(); chunkOffset += 24;
          let bitpos = this.edtbReversedBytes[i].length * 8 - 1;
          let effectSettings = new EffectSettings();
          effectSettings.enabled = (getNumberFromBits(this.edtbReversedBytes[i], bitpos, bitpos) === 1); bitpos -= 1;
          effectSettings.id = getNumberFromBits(this.edtbReversedBytes[i], bitpos - 28, bitpos); bitpos -= 29;
          effectSettings.parameters = new Array<number>();
          for (let p=0; p<5 && bitpos - 12 >= 0; p++) {
            let parameter = getNumberFromBits(this.edtbReversedBytes[i], bitpos - 11, bitpos); bitpos -= 12;
            effectSettings.parameters.push(parameter);
          }
          for (let p=5; p<8 && bitpos - 8 >= 0; p++) {
            let parameter = getNumberFromBits(this.edtbReversedBytes[i], bitpos - 7, bitpos); bitpos -= 8;
            effectSettings.parameters.push(parameter);
          }
          for (let p=8; p<12 && bitpos - 12 >= 0; p++) {
            let parameter = getNumberFromBits(this.edtbReversedBytes[i], bitpos - 11, bitpos); bitpos -= 12;
            effectSettings.parameters.push(parameter);
          }
          this.edtbEffectSettings.push(effectSettings);
        }
      }
    }

    chunkID = "PRM2";
    chunkData = this.chunks.get(chunkID);
    if (chunkData === undefined) {
      shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCF() chunk ID "${chunkID} not found in patch data - this.chunks.size = ${this.chunks.size}`);
    }
    else {
      chunkOffset = 0;
      this.PRM2 = chunkID;
      this.prm2Length = chunkData.length;
      if (this.prm2Length != null && this.prm2Length > 2) {
        this.prm2Unknown = chunkData.slice(chunkOffset, chunkOffset + this.prm2Length); chunkOffset += this.prm2Length;
        let tempo1 = this.prm2Unknown[this.prm2Unknown.length -2];
        let tempo2 = this.prm2Unknown[this.prm2Unknown.length -1];
        this.prm2Tempo = ((tempo1 & 0b11110000) >> 4) + ((tempo2 & 0b00001111) << 4);
        if (this.prm2Length > 10) {
          this.prm2EditEffectSlot = (this.prm2Unknown[10] & 0b11100000) >> 5;
        }
        /*
        o prm2 unknown byte 9 is always 0x80. But scanning through patches om MS-50G+ gives 1 anomaly (warning) for this (Krampus drive).
        o prm2 unknown byte 10 is always 3 effect slot bits, then 01100. But scanning through patches om MS-50G+ gives 1 anomaly (warning) for this (Krampus drive).
        o prm2 unknown bytes 11 and 12 change depending on effect slot. Byte 12 is probably logically before byte 11.

          Effect slot B11 B12 Bits 11  Bits 12  Bits 11
                    1 42  86  01000010 10000110 01000010
                    2 64  A8  01100100 10101000 01100100
                    3 86  0A  10000110 00001010 10000110
                    4 A8  00  10101000 00000000 10101000
                    5 0A  00  00001010 00000000 00001010
                    6 00  00  00000000 00000000 00000000
              
          It's just a bit pattern that is shifted four bits to the right for each effect slot, 
          and it's the same for each patch, no matter which effect is selected in each slot. Weird.
        */


      }
    }

    chunkID = "NAME";
    chunkData = this.chunks.get(chunkID);
    if (chunkData === undefined) {
      shouldLog(LogLevel.Warning) && console.warn(`ZoomPatch.readPTCF() chunk ID "${chunkID} not found in patch data - this.chunks.size = ${this.chunks.size}`);
    }
    else {
      chunkOffset = 0;
      this.NAME = chunkID;
      this.nameLength = chunkData.length;
      if (this.nameLength != null && this.nameLength > 0) {
        this.nameName = this.readString(chunkData, chunkOffset, this.nameLength); chunkOffset += this.nameLength; 
        // FIXME: Perhaps we shouldn't remove the 0x00's here, to keep true to the original data??
        if (this.nameName != null)
          this.nameName = this.nameName.replaceAll("\x00", ""); // The last four characters could be 0x00
        // For MS Plus pedals, name is always 32 bytes, 28 bytes of ascii and four bytes of zero
        this.maxNameLength = this.nameLength == 32 ? this.nameLength - 4 : this.nameLength; // this.maxNameLength was set above, for ptcfShortName, but we update it here since a NAME chunk was found
      }
    }

    return offset;
  }

  /**
   * Creates one PTCF chunk from the different chunks in the patch. This PTCF chunk can then be sent to the pedal as a patch.
   */
  buildPTCFChunk(): Uint8Array | undefined
  {
    this.updatePatchPropertiesFromDerivedProperties();

    if (this.PTCF === null) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch ${this.name}. PTCF == null`);
      return undefined;
  }

    // TXJ1 chunk (japanese description) is assumed to be unchanged

    let txj1TotalLength = 0;
    if (this.TXJ1 !== null) {
      if (this.txj1Length === null) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. TXJ1 != null, txj1Length == null.`);
        return undefined;
      }
      txj1TotalLength = 4 + 4 + this.txj1Length;
    } 

    // TXE1 chunk (english description) 

    let txe1TotalLength = 0;
    if (this.TXE1 !== null) {
      if (this.txe1Length === null) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. TXE1 != null, txe1Length == null. `);
        return undefined;
      }
      txe1TotalLength = 4 + 4 + this.txe1Length;
    } 

    // EDTB chunk (parameters)
    let edtbTotalLength = 0;
    if (this.EDTB !== null) {
      if (this.edtbLength === null) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. EDTB != null, edtbLength == null. `);
        return undefined;
      }
      edtbTotalLength = 4 + 4 + this.edtbLength;
    } 

    // PRM2 chunk

    let prm2TotalLength = 0;
    if (this.PRM2 !== null) {
      if (this.prm2Length === null) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. PRM2 != null, prm2Length == null. `);
        return undefined;
      }
      prm2TotalLength = 4 + 4 + this.prm2Length;
    } 

    // NAME chunk is built from the name
    // On the MS Plus pedals, the name chunk is typically 32 bytes long.
    // The first 28 bytes consists of ASCII characters, padded with spaces at the end.
    // The last 4 bytes is 0
    let nameTotalLength = 0;
    if (this.NAME !== null) {
      if (this.nameLength === null) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. NAME != null, nameLength == null. `);
        return undefined;
      }
      nameTotalLength = 4 + 4 + this.nameLength;
    } 

    if (this.ids === null || this.numEffects === null || this.ids.length !== this.numEffects) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. ids = ${this.ids}, numEffects = ${this.numEffects}, ids.length = ${this.ids?.length}, ids.length != numEffects `);
      return undefined;
    }

    let ptcfToplevelDataLength = 
      4 + // version = 4 bytes
      4 + // numEffects = 4 bytes
      4 + // target = 4 bytes
      6 + // ptcfUnknown = 6 bytes
      10 + // ptcfFhortName = 10 bytes
      4 * this.numEffects; // ids = 4 * numEffects 

    let ptcfTotalLength = 4 + 4 + ptcfToplevelDataLength + txj1TotalLength + txe1TotalLength + edtbTotalLength + prm2TotalLength + nameTotalLength;
    let ptcfChunk = new Uint8Array(ptcfTotalLength);

    let offset = 0;
    let result = 0;
    let success: boolean = true;

    // Toplevel data in the PTCF chunk

    if (this.version === null || this.target === null || this.ptcfUnknown === null || this.ptcfShortName === null) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. version = ${this.version}, target = ${this.target}, ptchUnknown = ${this.ptcfUnknown}, ptchShortName = ${this.ptcfShortName}`);
      return undefined;
    }

    if (this.ptcfUnknown.length !== 6 ) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Unexpected length of unknown ptcf byte sequence for patch ${this.name}. Length is ${this.ptcfUnknown.lastIndexOf} but expected 6.`);
      return undefined;
    }

    if (this.ptcfShortName.length !== 10 ) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Unexpected length of short name for patch "${this.name}". Length is ${this.ptcfShortName.lastIndexOf} but expected 10.`);
      return undefined;
    }

    offset = result = this.writeString(ptcfChunk, offset, this.PTCF); success &&= (result !== 0);
    offset = result = this.writeInt32(ptcfChunk, offset, ptcfTotalLength); success &&= (result !== 0);
    offset = result = this.writeInt32(ptcfChunk, offset, this.version); success &&= (result !== 0);
    offset = result = this.writeInt32(ptcfChunk, offset, this.numEffects); success &&= (result !== 0);
    offset = result = this.writeInt32(ptcfChunk, offset, this.target); success &&= (result !== 0);
    offset = result = this.writeSlice(ptcfChunk, offset, this.ptcfUnknown); success &&= (result !== 0);
    offset = result = this.writeString(ptcfChunk, offset, this.ptcfShortName); success &&= (result !== 0);
    offset = result = this.writeInt32Array(ptcfChunk, offset, this.ids); success &&= (result !== 0);

    if (!success) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch "${this.name}". Patch buffer size incorrect.`);
      return undefined;
    }

    let expectedOffset = 4 + 4;
    expectedOffset += ptcfToplevelDataLength; 
    if (offset !== expectedOffset) {
      shouldLog(LogLevel.Error) && console.error(`Unexpected offset when attempting to build patch buffer for patch "${this.name}". offset = ${offset}, expected offset = ${expectedOffset}`);
      return undefined;
    }

    // TXJ1 chunk

    if (this.TXJ1 === null) {
      shouldLog(LogLevel.Info) && console.log(`Skipping empty TXJ1 chunk when attempting to build patch buffer for patch "${this.name}"`);
    }
    else {
      if (this.txj1Length === null || (this.txj1Length > 0 && this.txj1DescriptionJapanese === null)) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. txj1Length = ${this.txj1Length}, txj1DescriptionJapanese = ${this.txj1DescriptionJapanese}`);
        return undefined;
      }
  
      offset = result = this.writeString(ptcfChunk, offset, this.TXJ1); success &&= (result !== 0);
      offset = result = this.writeInt32(ptcfChunk, offset, this.txj1Length); success &&= (result !== 0);
      if (this.txj1DescriptionJapanese !== null) {
        if (this.txj1DescriptionJapanese.length !== this.txj1Length) {
          shouldLog(LogLevel.Error) && console.error(`Inconsistent patch data. this.txj1DescriptionJapanese.length = ${this.txj1DescriptionJapanese.length}, this.txj1Length = ${this.txj1Length}`)
          return undefined;
        }
        offset = result = this.writeSlice(ptcfChunk, offset, this.txj1DescriptionJapanese); success &&= (result !== 0);  
      }
    }  

    expectedOffset += txj1TotalLength; 
    if (offset !== expectedOffset) {
      shouldLog(LogLevel.Error) && console.error(`Unexpected offset when attempting to build patch buffer for patch "${this.name}". offset = ${offset}, expected offset = ${expectedOffset}`);
      return undefined;
    }

    // TXE1 chunk

    if (this.TXE1 === null) {
      shouldLog(LogLevel.Info) && console.log(`Skipping empty TXE1 chunk when attempting to build patch buffer for patch "${this.name}"`);
    }
    else {
      if (this.txe1Length === null || (this.txe1Length > 0 && this.txe1DescriptionEnglish === null)) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. txe1Length = ${this.txe1Length}, txe1DescriptionJapanese = ${this.txe1DescriptionEnglish}`);
        return undefined;
      }
  
      offset = result = this.writeString(ptcfChunk, offset, this.TXE1); success &&= (result !== 0);
      offset = result = this.writeInt32(ptcfChunk, offset, this.txe1Length); success &&= (result !== 0);
      if (this.txe1DescriptionEnglish !== null) {
        if (this.txe1DescriptionEnglish.length !== this.txe1Length) {
          shouldLog(LogLevel.Error) && console.error(`Inconsistent patch data. this.txe1DescriptionEnglish.length = ${this.txe1DescriptionEnglish.length}, this.txe1Length = ${this.txe1Length}`)
          return undefined;
        }
        offset = result = this.writeString(ptcfChunk, offset, this.txe1DescriptionEnglish); success &&= (result !== 0);  
      }
    }  

    expectedOffset += txe1TotalLength; 
    if (offset !== expectedOffset) {
      shouldLog(LogLevel.Error) && console.error(`Unexpected offset when attempting to build patch buffer for patch "${this.name}". offset = ${offset}, expected offset = ${expectedOffset}`);
      return undefined;
    }

    // EDTB Chunk

    if (this.EDTB === null) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch "${this.name}". EDTB chunk is missing."`);
      return undefined;
    } 

    if (this.edtbReversedBytes === null) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch "${this.name}". edtbReversedBytes = null.`);
      return undefined;
    }

    if (this.edtbLength === null) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. edtbLength = ${this.edtbLength}`);
      return undefined;
    }

    if (this.effectSettings === null) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. effectSettings = ${this.effectSettings}`);
      return undefined;
    }

    offset = result = this.writeString(ptcfChunk, offset, this.EDTB); success &&= (result !== 0);
    offset = result = this.writeInt32(ptcfChunk, offset, this.edtbLength); success &&= (result !== 0);

    for (let i=0; i<this.numEffects; i++) {
      let reversedBytes = new Uint8Array(24);
      if (this.edtbReversedBytes[i].length !== reversedBytes.length) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch "${this.name}". Unexpected length of edtbReversedBytes[${i}]. edtbReversedBytes[${i}] = ${this.edtbReversedBytes[i].length}, expected ${reversedBytes.length}.`);
        return undefined;
      }
      reversedBytes.set(this.edtbReversedBytes[i], 0);

      let effectSettings = this.effectSettings[i];

      let bitpos = reversedBytes.length * 8 - 1;
      setBitsFromNumber(reversedBytes, bitpos, bitpos, effectSettings.enabled ? 1 : 0); bitpos -= 1;
      setBitsFromNumber(reversedBytes, bitpos - 28, bitpos, effectSettings.id); bitpos -= 29;
      let parameterIndex = 0;
      for (let p=0; p<5 && bitpos - 12 >= 0; p++) {
        let parameter = effectSettings.parameters[parameterIndex++];
        setBitsFromNumber(reversedBytes, bitpos - 11, bitpos, parameter); bitpos -= 12;
      }
      for (let p=5; p<8 && bitpos - 8 >= 0; p++) {
        let parameter = effectSettings.parameters[parameterIndex++];
        setBitsFromNumber(reversedBytes, bitpos - 7, bitpos, parameter); bitpos -= 8;
      }
      for (let p=8; p<12 && bitpos - 12 >= 0; p++) {
        let parameter = effectSettings.parameters[parameterIndex++];
        setBitsFromNumber(reversedBytes, bitpos - 11, bitpos, parameter); bitpos -= 12;
      }

      let rightOrderBytes = reversedBytes.reverse();
      offset = result = this.writeSlice(ptcfChunk, offset, rightOrderBytes); success &&= (result !== 0);  
    }

    expectedOffset += edtbTotalLength; 
    if (offset !== expectedOffset) {
      shouldLog(LogLevel.Error) && console.error(`Unexpected offset when attempting to build patch buffer for patch "${this.name}". offset = ${offset}, expected offset = ${expectedOffset}`);
      return undefined;
    }

    // PRM2 chunk

    if (this.PRM2 === null) {
      shouldLog(LogLevel.Info) && console.log(`Skipping empty PRM2 chunk when attempting to build patch buffer for patch "${this.name}"`);
    }
    else {
      if (this.prm2Length === null || this.prm2Unknown === null) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. prm2Length = ${this.prm2Length}, prm2Unknown = ${this.prm2Unknown}`);
        return undefined;
      }

      let tempo1 = this.prm2Unknown[this.prm2Unknown.length -2];
      let tempo2 = this.prm2Unknown[this.prm2Unknown.length -1];
      tempo1 &=  0b00001111; // blank the 4 upper bits
      tempo1 |= (this.tempo & 0b00001111) << 4; // move the 4 lower bits in this.tempo into the 4 upper bits in tempo1
      tempo2 &=  0b11110000; // blank the 4 lower bits
      tempo2 |= (this.tempo & 0b11110000) >> 4; // move the 4 upper bits in this.tempo into the 4 lower bits in tempo2
      
      this.prm2Unknown[this.prm2Unknown.length -2] = tempo1;
      this.prm2Unknown[this.prm2Unknown.length -1] = tempo2;

      if (this.prm2Length > 10) {
        this.prm2Unknown[10] = (this.prm2Unknown[10] & 0b00011111) | (this.currentEffectSlot & 0b00000111) << 5;
      }

      offset = result = this.writeString(ptcfChunk, offset, this.PRM2); success &&= (result !== 0);
      offset = result = this.writeInt32(ptcfChunk, offset, this.prm2Length); success &&= (result !== 0);
      offset = result = this.writeSlice(ptcfChunk, offset, this.prm2Unknown); success &&= (result !== 0);  
    }  
    
    expectedOffset += prm2TotalLength; 
    if (offset !== expectedOffset) {
      shouldLog(LogLevel.Error) && console.error(`Unexpected offset when attempting to build patch buffer for patch "${this.name}". offset = ${offset}, expected offset = ${expectedOffset}`);
      return undefined;
    }

    // NAME chunk

    if (this.NAME === null) {
      shouldLog(LogLevel.Info) && console.log(`Skipping empty NAME chunk when attempting to build patch buffer for patch "${this.name}"`);
    }
    else {
      if (this.nameLength === null || this.nameName === null) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. nameLength = ${this.nameLength}, nameName = ${this.nameName}`);
        return undefined;
      }
       
      // For MS Plus pedals, name is always 32 bytes, 28 bytes of ascii and four bytes of zero
      let enforceLength = 32;

      if (this.nameName.length !== this.nameLength) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. nameLength = ${this.nameLength}, nameName.length = ${this.nameName.length}, nameName = "${this.nameName}"`);
        return undefined;
      }

      if (this.nameName.length !== enforceLength) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch ${this.name}. Expected nameLength to be ${enforceLength}. nameLength = ${this.nameLength}"`);
        return undefined;
      }
     
      offset = result = this.writeString(ptcfChunk, offset, this.NAME); success &&= (result !== 0);
      offset = result = this.writeInt32(ptcfChunk, offset, this.nameLength); success &&= (result !== 0);
      offset = result = this.writeString(ptcfChunk, offset, this.nameName, this.nameLength); success &&= (result !== 0);  
    }  

    expectedOffset += nameTotalLength; 
    if (offset !== expectedOffset) {
      shouldLog(LogLevel.Error) && console.error(`Unexpected offset when attempting to build patch buffer for patch "${this.name}". offset = ${offset}, expected offset = ${expectedOffset}`);
      return undefined;
    }

    // compareBuffers(ptcfChunk, this.ptcfChunk);

    this.ptcfChunk = ptcfChunk;
    return this.ptcfChunk;
  }

  buildMSDataBuffer(): Uint8Array | undefined
  {
    this.updatePatchPropertiesFromDerivedProperties();

    if (this.MSOG === null) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch ${this.name}. MSOG == null`);
      return undefined;
    }

    // calculate size

    if (this.msogEffectsReversedBytes === null || this.msogNumEffects === null || this.msogUnknown1 === null || this.msogName === null || this.msogUnknown2 === null) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch ${this.name}. this.msogEffectsReversedBytes = ${this.msogEffectsReversedBytes}` + 
        `, this.msogNumEffects = ${this.msogNumEffects}, this.msogUnknown1 = ${this.msogUnknown1}, this.msogName = ${this.msogName}, this.msogUnknown2 = ${this.msogUnknown2}`);
      return undefined;
    }

    if (this.msogUnknown1.length !== 3) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch ${this.name}. Inconsistent patch data. this.msogUnknown1.length !== 3`);
      return undefined;
    }

    if (this.msogName.length !== 10) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch ${this.name}. Inconsistent patch data. this.msogName.length !== 10`);
      return undefined;
    }

    if (this.msogUnknown2.length !== 1) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch ${this.name}. Inconsistent patch data. this.msogUnknown2.length !== 1`);
      return undefined;
    }

    let effectSectionLength = 18;

    let msogTotalLength = this.maxNumEffects * effectSectionLength + this.msogUnknown1.length + this.msogName.length + this.msogUnknown2.length;

    if (this.msogDataBuffer !== null && msogTotalLength !== this.msogDataBuffer.length) {
      shouldLog(LogLevel.Warning) && console.warn(`Mismatched buffer sizes when building patch buffer for patch ${this.name}. msogTotalLength !== this.msogDataBuffer.length. msogTotalLength = ${msogTotalLength}, this.msogDataBuffer.length = ${this.msogDataBuffer.length}`);
    }

    if (this.effectSettings === null) {
      shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer. Inconsistent patch data for patch ${this.name}. effectSettings = ${this.effectSettings}`);
      return undefined;
    }

    let msogDataBuffer = new Uint8Array(msogTotalLength);

    let offset = 0;
    let result = 0;
    let success: boolean = true;

    for (let i=0; i<this.maxNumEffects; i++) { 
      let reversedBytes = new Uint8Array(effectSectionLength);
      if (this.msogEffectsReversedBytes[i].length !== reversedBytes.length) {
        shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch "${this.name}". Unexpected length of msogEffectsReversedBytes[${i}]. msogEffectsReversedBytes[${i}] = ${this.msogEffectsReversedBytes[i].length}, expected ${reversedBytes.length}.`);
        return undefined;
      }
      reversedBytes.set(this.msogEffectsReversedBytes[i], 0);
      let effectSettings = this.effectSettings[i];

      let bitpos = reversedBytes.length * 8 - 1;
      setBitsFromNumber(reversedBytes, bitpos, bitpos, effectSettings.enabled ? 1 : 0); bitpos -= 1;
      setBitsFromNumber(reversedBytes, bitpos - 27, bitpos, effectSettings.id); bitpos -= 28;
      let parameterIndex = 0;
      for (let p=0; p<3 && bitpos - 13 >= 0; p++) {
        let parameter = effectSettings.parameters[parameterIndex++];
        setBitsFromNumber(reversedBytes, bitpos - 12, bitpos, parameter); bitpos -= 13;
      }
      for (let p=3; p<8 && bitpos - 8 >= 0; p++) {
        let parameter = effectSettings.parameters[parameterIndex++];
        setBitsFromNumber(reversedBytes, bitpos - 7, bitpos, parameter); bitpos -= 8;
      }

      // P8 = 8 bits. It is oddly placed, and we don't know what the surrounding bits are (20 unknown bits before, 8 unknown bits after)
      // One byte is probably cab-related
      bitpos -= 20;
      let parameter = effectSettings.parameters[parameterIndex++];
      setBitsFromNumber(reversedBytes, bitpos - 7, bitpos, parameter); bitpos -= 8;

      this.msogEffectsReversedBytes[i].set(reversedBytes, 0);

      let rightOrderBytes = reversedBytes.reverse();
      offset = result = this.writeSlice(msogDataBuffer, offset, rightOrderBytes); success &&= (result !== 0);  
      
      // let reversedBytes = new Uint8Array(effectSectionLength);
      // if (this.msogEffectsReversedBytes[i].length !== reversedBytes.length) {
      //   shouldLog(LogLevel.Error) && console.error(`Unable to build patch buffer for patch "${this.name}". Unexpected length of msogEffectsReversedBytes[${i}]. msogEffectsReversedBytes[${i}].length = ${this.msogEffectsReversedBytes[i].length}, expected ${reversedBytes.length}.`);
      //   return undefined;
      // }
      // reversedBytes.set(this.msogEffectsReversedBytes[i], 0);
      // let rightOrderBytes = reversedBytes.reverse();
      // offset = result = this.writeSlice(msogDataBuffer, offset, rightOrderBytes); success &&= (result !== 0);  
    }

    let expectedOffset = 0;
    expectedOffset += this.maxNumEffects * effectSectionLength; 
    if (offset !== expectedOffset) {
      shouldLog(LogLevel.Error) && console.error(`Unexpected offset when attempting to build patch buffer for patch "${this.name}". offset = ${offset}, expected offset = ${expectedOffset}`);
      return undefined;
    }

    let tempo1 = this.msogUnknown1[1];
    let tempo2 = this.msogUnknown1[2];
    tempo1 &=  0b00011111; // blank the 3 upper bits
    tempo1 |= (this.tempo & 0b00000111) << 5; // move the 3 lower bits in this.tempo into the 3 upper bits in tempo1
    tempo2 &=  0b11100000; // blank the 5 lower bits
    tempo2 |= (this.tempo & 0b11111000) >> 3; // move the 5 upper bits in this.tempo into the 5 lower bits in tempo2

    this.msogUnknown1[1] = tempo1;
    this.msogUnknown1[2] = tempo2;
  
    let leftToRightEffectSlot = 5 - this.currentEffectSlot;
    this.msogUnknown1[0] &= 0b00111111; // blank the 2 upper bits
    this.msogUnknown1[0] |= (leftToRightEffectSlot & 0b00000011) << 6; // the two lower bits in the effect slot number
    this.msogUnknown1[1] &= 0b11111110; // blank the 1 lower bit
    this.msogUnknown1[1] |= (leftToRightEffectSlot & 0b00000100) >> 2; // bit 3 in the effect slot number
    // let leftToRightEffectSlot = ((this.msogUnknown1[0] & 0b11000000) >> 6) + ((this.msogUnknown1[1] & 0b00000001) << 2);

    offset = result = this.writeSlice(msogDataBuffer, offset, this.msogUnknown1); success &&= (result !== 0);  

    expectedOffset += this.msogUnknown1.length; 
    if (offset !== expectedOffset) {
      shouldLog(LogLevel.Error) && console.error(`Unexpected offset when attempting to build patch buffer for patch "${this.name}". offset = ${offset}, expected offset = ${expectedOffset}`);
      return undefined;
    }

    offset = result = this.writeString(msogDataBuffer, offset, this.msogName); success &&= (result !== 0);

    expectedOffset += this.msogName.length; 
    if (offset !== expectedOffset) {
      shouldLog(LogLevel.Error) && console.error(`Unexpected offset when attempting to build patch buffer for patch "${this.name}". offset = ${offset}, expected offset = ${expectedOffset}`);
      return undefined;
    }

    offset = result = this.writeSlice(msogDataBuffer, offset, this.msogUnknown2); success &&= (result !== 0);  

    expectedOffset += this.msogUnknown2.length; 
    if (offset !== expectedOffset) {
      shouldLog(LogLevel.Error) && console.error(`Unexpected offset when attempting to build patch buffer for patch "${this.name}". offset = ${offset}, expected offset = ${expectedOffset}`);
      return undefined;
    }

    compareBuffers(msogDataBuffer, this.msogDataBuffer);

    this.msogDataBuffer = msogDataBuffer;
    return this.msogDataBuffer;
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
    this.maxNumEffects = 6; // FIXME add support for other pedals, like MS-60B with 4 effects. See FIXME below on msogNumEffects.
    this.msogEffectsReversedBytes = new Array<Uint8Array>(this.maxNumEffects);
    this.msogEffectSettings = new Array<EffectSettings>();
    this.ids = new Uint32Array(this.maxNumEffects);
    for (let i=0; i<this.maxNumEffects; i++) { // Each effect section is 18 bytes
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

    let leftToRightEffectSlot = ((this.msogUnknown1[0] & 0b11000000) >> 6) + ((this.msogUnknown1[1] & 0b00000001) << 2);
    this.msogEditEffectSlot = 5 - leftToRightEffectSlot;

    this.msogDSPFullBits = (this.msogUnknown1[0] & 0b00111111);

    this.msogNumEffects = (this.msogUnknown1[1] & 0b00011100) >> 2;
    this.numEffects = this.msogNumEffects;
    // FIXME: Think through the difference between num effects used in a patch and the max number of effects for a device
    // we need to read 6 effects here to get the offsets right...

    // FIXME: We should probably read msogNumEffects first, with a fixed offset from the end, then use that as the loop for reading parameters
    // No, because msogNumEffects is the actual number of effects in the chain, not the max number of effects

    // this.ids.slice(0, this.msogNumEffects);
    // this.msogEffectsReversedBytes.slice(0, this.msogNumEffects);
    // this.msogEffectSettings.slice(0, this.msogNumEffects);

    this.maxNameLength = 10;
    this.msogName = this.readString(data, offset, 10); offset += 10; 
    if (this.msogName != null)
      this.msogName = this.msogName.replaceAll("\x00", ""); // Safety guard against characters being 0

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
    zoomPatch.updateDerivedPropertiesFromPatchProperties();

    return zoomPatch;
  }

  public static noteByteCodeToHtmlSlow(valueString: string): string
  {
    // https://www.alt-codes.net/music_note_alt_codes.php
    // https://www.fileformat.info/info/unicode/char/1D15E/index.htm
    return valueString.replaceAll(/\x16/g, "&#119138;").replace(/\x17/g, "&#119137;").replace(/\x18/g, "&#119136;").replace(/\x19/g, "&#119135;").replace(/\x1A/g, "&#119134;");
  }

  public static noteByteCodeToHtml(valueString: string): string
  {
    // https://www.alt-codes.net/music_note_alt_codes.php
    // https://www.fileformat.info/info/unicode/char/1D15E/index.htm
    return valueString.length == 0 ? valueString :
      valueString[0] === "\x16" ? "&#119138;" + valueString.slice(1) :
      valueString[0] === "\x17" ? "&#119137;" + valueString.slice(1) :
      valueString[0] === "\x18" ? "&#119136;" + valueString.slice(1) :
      valueString[0] === "\x19" ? "&#119135;" + valueString.slice(1) :
      valueString[0] === "\x1A" ? "&#119134;" + valueString.slice(1) :
      valueString;
  }

  public static noteHtmlToByteCode(valueString: string): string
  { // 0x16: 32nd note
    // 0x17: 16th note
    // 0x18: 8th note
    // 0x19: quarter note
    // 0x1A: half note
    return valueString.replace(/&#119138;/g, "\x16").replace(/&#119137;/g, "\x17").replace(/&#119136;/g, "\x18").replace(/&#119135;/g, "\x19").replace(/&#119134;/g, "\x1A");
  }

  public static noteUTF16ToHtmlSlow(valueString: string): string
  {
    return valueString.replace(/\uD834\uDD62/g, "&#119138;").replace(/\uD834\uDD61/g, "&#119137;").replace(/\uD834\uDD60/g, "&#119136;").replace(/\uD834\uDD5F/g, "&#119135;").replace(/\uD834\uDD5E/g, "&#119134;");
  }

  public static noteUTF16ToHtml(valueString: string): string
  {
    return valueString.length <= 1 ? valueString :
      valueString[1] === "\uDD62" ? "&#119138;" + valueString.slice(2) :
      valueString[1] === "\uDD61" ? "&#119137;" + valueString.slice(2) :
      valueString[1] === "\uDD60" ? "&#119136;" + valueString.slice(2) :
      valueString[1] === "\uDD5F" ? "&#119135;" + valueString.slice(2) :
      valueString[1] === "\uDD5E" ? "&#119134;" + valueString.slice(2) :
      valueString;
  }

  public static isNoteHtml(valueString: string): boolean
  { // See KnobView.startsWithHtmlCharacter()
    return valueString.length >= 9 && valueString[0] === "&";
  }
}