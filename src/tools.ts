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
  return Array.from(bytes, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join(" ").toUpperCase();
}

