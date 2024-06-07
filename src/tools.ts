export function getFunctionName(stackLevel: number = 0): string
{
  let error = new Error();
  return error.stack ? error.stack.split('at ')[2 + stackLevel].split(' ')[0] : "unknown";
}

export function getExceptionErrorString(err:any, extra?: string): string
{
  let message = `ERROR: Exception in ${getFunctionName()}${extra !== undefined ? " " + extra : ""} - `;
  if (err != null && typeof (err) === "object")
    if ("name" in err && "message" in err)
      message += `"${err.name}" "${err.message}"`;
    else
      message += `"${err}"`
  return message;
}

export function toHexString(bytes: Iterable<number> | ArrayLike<number>, separator: string = '') : string
{
  return Array.from(bytes, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join(separator).toUpperCase();
}

export function toUint8Array(str: string, separator: string = '') : Uint8Array
{
  str = str.replace(new RegExp(`/${separator}/g`), "").replace(/ /g, "").replace(/0x/g, "");
  let dataArray = str.match(/.{1,2}/g)?.map((hex) => parseInt(hex, 16));
  return dataArray != undefined ? Uint8Array.from(dataArray) : new Uint8Array();
} 

export function partialArrayMatch(bigArray: Uint8Array, smallArray: Uint8Array, bigArrayOffset: number = 0): boolean
{
  return bigArray.length + bigArrayOffset >= smallArray.length && bigArray.slice(bigArrayOffset, bigArrayOffset + smallArray.length).every( (element, index) => element === smallArray[index] );
}

export function partialArrayStringMatch(bigArray: Uint8Array, str: string, bigArrayOffset: number = 0): boolean
{
  return bigArray.length + bigArrayOffset >= str.length && bigArray.slice(bigArrayOffset, bigArrayOffset + str.length).every( 
    (element, index) => element === (str.charCodeAt(index) & 0xFF) );
}

/**
 * 
 * @param data array with 8-bit data
 * @param startBit first bit to include, counting from the start of the array
 * @param endBit last bit to include, counting from the start of the array
 * @returns a number built from the specified bits
 */
export function getNumberFromBits(data: Uint8Array, startBit: number, endBit: number) : number
{
  let startByte = Math.floor(startBit / 8);
  let endByte = Math.floor(endBit / 8);
  let startBitOffset = startBit % 8;
  let endBitOffset = endBit % 8;
  
  let startMask = 0b0000000011111111 >> startBitOffset; 
  let endMask = (0b1111111100000000 >> (endBitOffset + 1)) & 0b11111111; 
  
  let value = 0;
  let byte: number = 0;
  
  for (let i = endByte; i>= startByte; i--) {
    byte = data[i];
    if (i == startByte)
      byte = byte & startMask;
    if (i == endByte)
      byte = byte & endMask;

    value += byte << ((endByte - i) * 8);
  }
  value = value >> (7-endBitOffset);

  return value;
}

function buildCRCTable() : number[]
{
  let c;
  let table = [];
  for (let n =0; n < 256; n++) {
      c = n;
      for (let k =0; k < 8; k++) {
          c = ((c & 0b0000001) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      }
      table[n] = c;
  }
  return table;
}

let crc32table: number[] | null = null;

/**
 * Calculates the 32-bit CRC value for the data
 * @param data Buffer containing data to calculate CRC for
 * @param offset First byte in the data array to include in the CRC calculation
 * @param end Last byte (inclusive) in the data array to include in the CRC calculation
 * @returns 32-bit CRC value for the data
 */
export function crc32(data: Uint8Array, offset: number = 0, end: number = -1)
{
  if (end === -1)
    end = data.length - 1;

  if (crc32table === null)
    crc32table = buildCRCTable();
  let crc = 0 ^ (-1);

  for (let i = offset; i <= end; i++ ) {
      crc = (crc >>> 8) ^ crc32table[(crc ^ data[i]) & 0xFF];
  }

  return (crc ^ (-1)) >>> 0;
}

/**
 * Converts a buffer created with the eight2seven algorithm from 7-bit and back to 8 bit again.
 * @see https://www.echevarria.io/blog/midi-sysex/index.html
 * @see https://llllllll.co/t/midi-sysex-7bit-decoding-help-bits-and-bytes/40854 (but note the order of the hogh bits in the 7-bit high-bit byte)
 * @param sevenBitBytes 
 * @param start 
 * @param end 
 * @returns 
 *
 * @example
 * 8 7-bit bytes will be converted to 7 8-bit bytes.
 * 
 * byte 0: [a7][a6][a5][a4][a3][a2][a1][a0]
 * byte 1: [b7][b6][b5][b4][b3][b2][b1][b0]
 * byte 2: [c7][c6][c5][c4][c3][c2][c1][c0]
 * byte 3: [d7][d6][d5][d4][d3][d2][d1][d0]
 * byte 4: [e7][e6][e5][e4][e3][e2][e1][e0]
 * byte 5: [f7][f6][f5][f4][f3][f2][f1][f0]
 * byte 6: [g7][g6][g5][g4][g3][g2][g1][g0]
 * 
 * is converted to:
 * 
 * byte 0: [0][a7][b7][c7][d7][e7][f7][g7]
 * byte 1: [0][a6][a5][a4][a3][a2][a1][a0]
 * byte 2: [0][b6][b5][b4][b3][b2][b1][b0]
 * byte 3: [0][c6][c5][c4][c3][c2][c1][c0]
 * byte 4: [0][d6][d5][d4][d3][d2][d1][d0]
 * byte 5: [0][e6][e5][e4][e3][e2][e1][e0]
 * byte 6: [0][f6][f5][f4][f3][f2][f1][f0]
 * byte 7: [0][g6][g5][g4][g3][g2][g1][g0]
 */
export function seven2eight(sevenBitBytes: Uint8Array, start: number = 0, end: number = -1) : Uint8Array
{
  if (end === -1)
    end = sevenBitBytes.length - 1;

  // let eightBitBytes: Uint8Array = new Uint8Array(end - start + 1); // FIXME: we don't need all this space. Calculate.
  let remainder = (end - start + 1) % 8;
  if (remainder === 1)
  {
    console.error(`remainder === 1. Illegal encoding for array of seven bit bytes of length ${sevenBitBytes.length}. Ignoring last seven bit byte`);
  }
  let eightBitBytes: Uint8Array = new Uint8Array( Math.floor((end - start + 1) / 8) * 7 + (remainder < 2 ? 0 : remainder - 1 ) );

  let eightIndex = 0;
  let bitIndex;
  let seven;
  let highBits: number = 0;
  let sevenIndex = start;
  
  while (sevenIndex <= end) {
    seven = sevenBitBytes[sevenIndex];
    bitIndex = 7 - (sevenIndex - start) % 8;
    if (bitIndex == 7)
      highBits = seven;
    else {
      eightBitBytes[eightIndex++] = seven + (((highBits >> bitIndex) & 1) << 7);
    }

    sevenIndex++;
  }

  return eightBitBytes;
}

/**
 * Converts a buffer with 8-bit bytes to a (larger) buffer with 7-bit bytes, suitable to be sent over MIDI sysex.
 * @see https://www.echevarria.io/blog/midi-sysex/index.html
 * @see https://llllllll.co/t/midi-sysex-7bit-decoding-help-bits-and-bytes/40854
 * @param eightBitBytes 
 * @param start 
 * @param end inclusive
 * @returns 
 */
export function eight2seven(eightBitBytes: Uint8Array, start: number = 0, end: number = -1) : Uint8Array
{
  if (end === -1)
    end = eightBitBytes.length - 1;

  let sevenBitBytes: Uint8Array = new Uint8Array( (end - start + 1) + Math.ceil((end - start + 1) / 7) );

  let eightIndex = start;
  let eight;
  let sevenIndex = 0;
  let eightBlockOffset = 0;
  let sevenBlockIndex = 0;
  while (eightIndex <= end) {
    eightBlockOffset = (eightIndex - start) % 7;

    if (eightBlockOffset === 0)
      sevenBlockIndex = sevenIndex++;
    
    eight = eightBitBytes[eightIndex];
    sevenBitBytes[sevenBlockIndex] |= ( (eight & 0b10000000) >> (eightBlockOffset + 1) ); // The high-bit of the 8-bit-byte goes into the "high-bit" 7-bit-byte (the 7-bit-byte that contains all the high bits)
    sevenBitBytes[sevenIndex] = eight & 0b01111111; // The rest of the bits in the 8-bit-byte
    
    sevenIndex++;
    eightIndex++;
  }

  return sevenBitBytes;
}

