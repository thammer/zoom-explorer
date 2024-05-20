


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
  txj1Unknown: null | Uint8Array = null; // txj1Length bytes

  // Description
  TXE1: null | string = null; // 4 + 4 + txe1Length bytes
  txe1Length: null | number = null; // 4 bytes
  txe1Description: null | string = null; // txe1Length bytes

  EDTB: null | string = null; // 4 + 4 + numEffects * 24 bytes == 4 + 4 + edtbLength bytes
  edtbLength: null | number = null; // 4 bytes
  edtbEffectParameters: null | Array<Uint8Array> = null; // numEffects * 24 bytes == edtbLength bytes

  PRM2: null | string = null; // 4 + 4 + prm2Length
  prm2Length: null | number = null; // 4 bytes
  prm2Unknown: null | Uint8Array = null; // prm2Length bytes

  NAME: null | string = null;
  nameLength: null | number = null; // 4 bytes
  longName: null | string = null; // 28 bytes == nameLength bytes. The last four characters are sometimes (always?) 0x00.

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
      this.txj1Unknown = patch.slice(offset, offset + this.txj1Length); offset += this.txj1Length;
    }

    this.TXE1 = this.readString(patch, offset, 4); offset +=4;
    this.txe1Length = this.readInt32(patch, offset); offset += 4;
    if (this.txe1Length != null && this.txe1Length > 0) {
      this.txe1Description = this.readString(patch, offset, this.txe1Length); offset += this.txe1Length;
    }

    if (this.numEffects !== null) {
      this.EDTB = this.readString(patch, offset, 4); offset +=4;
      this.edtbLength = this.readInt32(patch, offset); offset += 4;
      this.edtbEffectParameters = new Array<Uint8Array>(this.numEffects);
      for (let i=0; i<this.numEffects; i++) {
        this.edtbEffectParameters[i] = patch.slice(offset, offset + 24); offset += 24;
      }
    }

    this.PRM2 = this.readString(patch, offset, 4); offset +=4;
    this.prm2Length = this.readInt32(patch, offset); offset += 4;
    if (this.prm2Length != null && this.prm2Length > 0) {
      this.prm2Unknown = patch.slice(offset, offset + this.prm2Length); offset += this.prm2Length;
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

  static fromPatchData(patch: Uint8Array, offset: number = 0) : ZoomPatch 
  {
    let zoomPatch = new ZoomPatch();
    offset = zoomPatch.readPTCF(patch, offset);
    return zoomPatch;
  }
}