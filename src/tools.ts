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
