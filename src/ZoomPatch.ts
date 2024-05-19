


export class ZoomPatch
{
  PTCF: null | string = null;
  length: null | number = null;
  version: null | number = null;
  numEffects: null | number = null; 
  target: null | number = null;
  ptcfUnknown: null | Uint8Array = null; // 6 bytes
  name: null | string = null;
  ids: null | Uint32Array = null;

  TXJ1: null | string = null; // 8 bytes
  txj1Unknown: null | Uint8Array = null; // 4 bytes

  TXE1: null | string = null; // 8 bytes
  txe1Unknown: null | Uint8Array = null; // 4 bytes

  EDTB: null | string = null; // numEffects * 24 bytes
  edtbUnknown: null | Uint8Array = null;
  edtbPatchUnknown: null | Uint8Array = null;

  PRM2: null | string = null; // 32 bytes
  prm2Unknown: null | Uint8Array = null;

  NAME: null | string = null;
  nameUnknown: null | Uint8Array = null; // 4 bytes
  longName: null | string = null; // 28 bytes

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
    this.name = this.readString(patch, offset, 10); offset += 10;
    if (this.numEffects !== null) {
      this.ids = this.readInt32Array(patch, offset, this.numEffects);
      offset += this.numEffects * 4;
    }

    this.TXJ1 = this.readString(patch, offset, 4); offset +=4;
    this.txj1Unknown = patch.slice(offset, offset + 4); offset += 4;

    this.TXE1 = this.readString(patch, offset, 4); offset +=4;
    this.txe1Unknown = patch.slice(offset, offset + 4); offset += 4;

    if (this.numEffects !== null) {
      let length = this.numEffects * 24;
      this.EDTB = this.readString(patch, offset, 4); offset +=4;
      this.edtbUnknown = patch.slice(offset, offset + 4); offset += 4;
      this.edtbPatchUnknown = patch.slice(offset, offset + length); offset += length;
    }

    this.PRM2 = this.readString(patch, offset, 4); offset +=4;
    this.prm2Unknown = patch.slice(offset, offset + 36); offset += 36;

    this.NAME = this.readString(patch, offset, 4); offset +=4;
    this.nameUnknown = patch.slice(offset, offset + 4); offset += 4;
    this.longName = this.readString(patch, offset, 28); offset +=28;

    return offset;
  }

  static fromPatchData(patch: Uint8Array, offset: number = 0) : ZoomPatch 
  {
    let zoomPatch = new ZoomPatch();
    offset = zoomPatch.readPTCF(patch, offset);
    return zoomPatch;
  }
}