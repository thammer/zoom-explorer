import { shouldLog, LogLevel } from "./Logger.js";

export function getFunctionName(stackLevel: number = 0): string
{
  let error = new Error();
  if (!error.stack)
    return "unknown";
  if (error.stack.includes("at "))
    return error.stack.split("at ")[2 + stackLevel].split(' ')[0];
  else
    return error.stack.split("\n")[2 + stackLevel];
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

/**
 * Converts a number to a hexadecimal string.
 *
 * @param {number} number - the number to be converted
 * @return {string} a hexadecimal string representation of the number, padded with zeros to a minimum length of 8 characters
 */
export function numberToHexString(number: number) : string
{
  return number.toString(16).toUpperCase().padStart(8, "0");
}

export function bytesWithCharactersToString(bytes: Iterable<number> | ArrayLike<number>) : string
{
  return Array.from(bytes, byte => String.fromCharCode(byte)).join("");
}

/**
 * 
 * @param bytes Array of bytes
 * @param separator Optional separator character for the returned string 
 * @returns Hexadecimal string with each byte in the bytes arrae represented as a two-character hexadecimal string, with an optional separator between each two-character hexadecimal
 * @example Example return string "F0 52 00 6E 00 00 F7"
 */
export function bytesToHexString(bytes: Iterable<number> | ArrayLike<number>, separator: string = '') : string
{
  return Array.from(bytes, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join(separator).toUpperCase();
}

/**
 * 
 * @param str Hexadecimal string
 * @param separator 
 * @returns Uint8Array where each byte is converted from a 2-character hexadecimal string in the str string
 */
export function hexStringToUint8Array(str: string, separator: string = '') : Uint8Array
{
  str = str.replace(new RegExp(`/${separator}/g`), "").replaceAll(" ", "").replaceAll("0x", "");
  let dataArray = str.match(/.{1,2}/g)?.map((hex) => parseInt(hex, 16));
  return dataArray != undefined ? Uint8Array.from(dataArray) : new Uint8Array();
} 

export function partialArrayMatch(bigArray: Uint8Array, smallArray: Uint8Array, bigArrayOffset: number = 0): boolean
{
  return bigArray.length + bigArrayOffset >= smallArray.length && bigArray.slice(bigArrayOffset, bigArrayOffset + smallArray.length).every( (element, index) => element === smallArray[index] );
}

export function partialArrayStringMatch(bigArray: Uint8Array, str: string, bigArrayOffset: number = 0): boolean
{
  return bigArray.length - bigArrayOffset >= str.length && bigArray.slice(bigArrayOffset, bigArrayOffset + str.length).every( 
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

/**
 * 
 * @param data array with 8-bit data
 * @param startBit first bit to include, counting from the start of the array
 * @param endBit last bit to include, counting from the start of the array
 * @param value a number to decompose into bits and insert into array, starting from startBit, making sure that endBit contains the rightmost (lowest) bit in value
 */
export function setBitsFromNumber(data: Uint8Array, startBit: number, endBit: number, value: number): void
{
  let startByte = Math.floor(startBit / 8);
  let endByte = Math.floor(endBit / 8);
  let startBitOffset = startBit % 8;
  let endBitOffset = endBit % 8;
  
  let valueStartMask = (0b0000000011111111 >> startBitOffset) & 0b11111111; 
  let startMask =      (0b1111111100000000 >> startBitOffset) & 0b11111111; // keep bits before startBit, clear bits after startBit
  let valueEndMask =  (0b1111111100000000 >> (endBitOffset + 1)) & 0b11111111; 
  let endMask =        (0b0000000011111111 >> (endBitOffset + 1)) & 0b11111111; // clear bits before endBit, keep bits after endBit

  if (startByte === endByte) {
    startMask |= endMask; // ex 0b11000111, zeros from startBitOffset to endBitOffset, clear those bits, keep the surrounding bits
    endMask = startMask;
  }

  value = value << (7-endBitOffset);

  let byte: number = 0;
  
  for (let i = endByte; i>= startByte; i--) {
    byte = data[i];
    let valueByte = (value >> ((endByte - i) * 8)) & 0b11111111;
    if (i === startByte) {
      byte = byte & startMask;
      valueByte = valueByte & valueStartMask;
    }
    if (i === endByte) {
      byte = byte & endMask;
      valueByte = valueByte & valueEndMask;
    }
    if (i !== startByte && i !== endByte) {
      byte = 0; // Clear all bits for bytes that are inbetween the startByte and the endByte (the mask is 0x00000000)
    }

    byte = byte | valueByte;

    data[i] = byte;
  }
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
 * @see https://llllllll.co/t/midi-sysex-7bit-decoding-help-bits-and-bytes/40854 (but note the order of the high bits in the 7-bit high-bit byte)
 * @param sevenBitBytes 
 * @param start First byte in the sevenBitBytes array to include in the conversion
 * @param end Last byte (inclusive) in the sevenBitBytes array to include in the conversion.
 * @returns 8-bit buffer with converted data
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

  //let eightBitBytes: Uint8Array = new Uint8Array(end - start + 1); // FIXME: we don't need all this space. Calculate.
  let remainder = (end - start + 1) % 8;
  if (remainder === 1)
  {
    shouldLog(LogLevel.Error) && console.error(`remainder === 1. Illegal encoding for array of seven bit bytes of length ${sevenBitBytes.length} [${start}, ${end}]. Ignoring last seven bit byte`);
  }
  let eightBitBytes: Uint8Array = new Uint8Array( Math.floor((end - start + 1) / 8) * 7 + (remainder < 2 ? 0 : remainder - 1 ) );

//  let [numberOf8BitBytes, remainder] = getNumberOfEightBitBytes(end - start + 1);
//  let eightBitBytes: Uint8Array = new Uint8Array(numberOf8BitBytes);

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
 * 
 * @param numberOf7BitBytes 
 * @returns [number of 8 bit bytes, remainder]
 */
export function getNumberOfEightBitBytes(numberOf7BitBytes: number): [number, number]
{
  let remainder = numberOf7BitBytes % 8;
  return [Math.floor(numberOf7BitBytes / 8) * 7 + (remainder < 2 ? 0 : remainder - 1), remainder];
}

/**
 * Converts a buffer with 8-bit bytes to a (larger) buffer with 7-bit bytes, suitable to be sent over MIDI sysex.
 * @see https://www.echevarria.io/blog/midi-sysex/index.html
 * @see https://llllllll.co/t/midi-sysex-7bit-decoding-help-bits-and-bytes/40854
 * @param eightBitBytes 
 * @param start First byte in the eightBitBytes array to include in the conversion
 * @param end Last byte (inclusive) in the eightBitBytes array to include in the conversion.
 * @returns 7-bit buffer with converted data
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

export function compareBuffers(newBuffer: Uint8Array | undefined | null, oldBuffer: Uint8Array | undefined | null, doLogging: boolean = false): boolean
{
  if (newBuffer === null || newBuffer  == undefined) {
    doLogging && shouldLog(LogLevel.Warning) && console.warn(`newBuffer = ${newBuffer}`);
    return false;
  }
  else if (oldBuffer === null || oldBuffer  == undefined) {
    doLogging && shouldLog(LogLevel.Warning) && console.warn(`oldBuffer = ${oldBuffer}`);
    return false;
  }
  else if (newBuffer.length !== oldBuffer.length) {
    doLogging && shouldLog(LogLevel.Warning) && console.warn("newBuffer.length (${buffer1}) !== oldBuffer.length (${buffer1})");
    return false;
  }
  else {
    let allEqual = true;
    for (let i=0; i<newBuffer.length; i++) {
      if (newBuffer[i] !== oldBuffer[i]) {
        doLogging && shouldLog(LogLevel.Warning) && console.warn(`Buffers differ at newBuffer[${i}] = ${bytesToHexString([newBuffer[i]])} ` + 
          `(${newBuffer[i].toString(2).padStart(8, "0")}), oldBuffer[${i}] ${bytesToHexString([oldBuffer[i]])} (${oldBuffer[i].toString(2).padStart(8, "0")})`)
        allEqual = false;
        if (!doLogging)
          return false;
      }
    }
    if (allEqual) {
      doLogging && shouldLog(LogLevel.Info) && console.log("Buffers are identical");
    }
    return allEqual;
  }
}

export function sleepForAWhile(timeoutMilliseconds: number)
{
  return new Promise( (resolve) => 
  {
    setTimeout(() =>
    {
      resolve("Timed out");
    }, timeoutMilliseconds);
  });
}

/**
 * Converts a color from RGB to HSV
 * @param r Red in [0, 1]
 * @param g Green in [0, 1]
 * @param b Blue in [0, 1]
 * @returns [h, s, v], where h in [0, 360), s in [0, 1], v in [0, 1]
 */
export function rgb2hsv(r: number, g: number, b: number): [h: number, s: number, v: number]
{
  let v=Math.max(r,g,b), c=v-Math.min(r,g,b);
  let h= c && ((v==r) ? (g-b)/c : ((v==g) ? 2+(b-r)/c : 4+(r-g)/c)); 
  return [60*(h<0?h+6:h), v&&c/v, v];
}

/**
 * Converts a color from HSV to RGB
 * @param h Hue in [0, 360)
 * @param s Saturation in [0, 1]
 * @param v Value in [0, 1]
 * @returns [r, g, b], where r, g and b in [0, 1]
 */
export function hsv2rgb(h: number, s: number, v: number): [r: number, g: number, b: number]
{                              
  let f= (n: number,k=(n+h/60)%6) => v - v*s*Math.max( Math.min(k,4-k,1), 0);     
  return [f(5),f(3),f(1)];       
}   