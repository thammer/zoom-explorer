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

export function partialArrayMatch(bigArray: Uint8Array, smallArray: Uint8Array): boolean
{
  return bigArray.length >= smallArray.length && bigArray.slice(0, smallArray.length).every( (element, index) => element === smallArray[index] );
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
  
  // loop through bytes, from end to start
  // bitmask end and start if needed, keep the rest unmasked
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
