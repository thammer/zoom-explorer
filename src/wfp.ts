import { toHexString } from "./tools.js";

export enum WFPPayloadType
{
  Unknown = "?",
  ASCII = "A",
  GzipB64URL = "Z"  
}

/**
 * Support for reading and writing data in the WFP (WaveFormerPatch) format, typically containing a patch for a MIDI device in the form of MIDI sysex data.
 * 
 * At the top level, A WFP file consists of a four byte file ID (WFPA or WFPZ), a 2 byte version number (in human-readable hexadecimal ascii), and then a payload.
 * The payload can be ascii, or gzipped and base-64-urlL encoded ascii.
 * 
 * If payload if gzipped and base-64-url encoded (file ID is WFPZ), the payload should be decompressed before the contents is processed further. 
 * After decompression, the processing should be identical to the ascii encoded payload (file ID is WFPA).
 * 
 * The payload consists of one or more chunks of data. Each chunk of data has a four byte chunk ID and a four character chunk length in hexadecimal format. 
 * Both the chunk ID and the chunk length are human readable strings. 
 * The chunk data would normally represent 8-bit binary data as 2-character hexadecimal ascii strings, 
 * however in there is nothing in the file format that prevents chunks to contain other types of data, like regular text strings. 
 * The chunk length is the number of characters in the data string divided.
 * 
 * <chunk ID> <chunk length> <chunk data>
 * 
 * Example: A WFP file with one chunk of data with ID "ABCD" and 6 bytes of data (Decimal: 0, 5, 10, 15, 20, 25. Hexadecimal: 00, 05, 0A, 0F, 14, 19) would be represented as:
 *   "WPFA01ABCD000600050A0F1419".  
 *
 * Chunk IDs:
 *   * SIRX = Sysex ID Reply (RX = receive), the sysex message received from the device after sending the MIDI ID request command, F0 7E 7F 06 01 F7
 *   * SPTX = Sysex patch request command (TX = transmit)
 *   * SPRX = Sysex patch response (RX = receive)
 * 
 * There will probably be other chunk IDs in the future, and some of those ChunkIDs might indicate that the
 * chunk data is ascii or unicode, and not hexadecimal ascii strings.
 */


// https://evanhahn.com/javascript-compression-streams-api-with-strings/
// https://dev.to/ternentdotdev/json-compression-in-the-browser-with-gzip-and-the-compression-streams-api-4135

async function compress(str: string) : Promise<Uint8Array> 
{
  const stream = new Blob([str]).stream();
  const compressedStream = stream.pipeThrough(
    new CompressionStream("gzip")
  );

  const compressedResponse = new Response(compressedStream);
  const blob = await compressedResponse.blob();
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

async function decompress(data: Uint8Array) : Promise<string>
{
  const stream = new Blob([data], {
    type: "application/json",
  }).stream();

  const compressedReadableStream = stream.pipeThrough(
    new DecompressionStream("gzip")
  );

  const resp = new Response(compressedReadableStream);
  const blob = await resp.blob();
  const str = blob.text();
  return str;
}

/**
 * 
 * @param data 
 * @returns String with data encoded as Base64URL
 */
function encode(data: Uint8Array) : string
{
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * 
 * @param str Base64URL encoded string
 * @returns Array with binary data decoded from the Base64URL encoded string
 */
function decode(str: string): Uint8Array // Why ArrayBuffer ????
{
  str = str.replace(/\-/g, "+").replace(/_/g, "/");
  var padding = str.length % 4;
  str += padding >= 2 ? new Array(5-padding).join('=') : "";
  const binary_string = window.atob(str);
  const len = binary_string.length;
  const bytes = new Uint8Array(new ArrayBuffer(len)); // Why ArrayBuffer ????
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

export async function encodeWFP(chunks: Map<string, Uint8Array>, format: WFPPayloadType) : Promise<string>
{
  let fileID = "WFP" + format;
  let fileVersion = "01";
  let payload = "";

  for (let [id, data] of chunks)
  {
    let hex = toHexString(data);
    if (hex.length > 0xFFFF) {
      hex = hex.slice(0, 0xFFFF);
      console.warn(`encodeWFP cannot encode more than ${0xFFFF/2} bytes in one chunk`);
    }
    let length = hex.length.toString(16).toUpperCase().padStart(4, "0");
    payload += id + length + hex
  }

  if (format === WFPPayloadType.GzipB64URL)
  {
    let data = await compress(payload);
    payload = encode(data); 
  }

  return fileID + fileVersion + payload;
}

export async function decodeWFP(file: string) : Promise<Map<string, Uint8Array>>
{
  let chunks = new Map<string, Uint8Array>();
  let fileID = file.slice(0, 4);
  let format = file.slice(3,4);
  let fileVersion = parseInt(file.slice(4, 6), 16);
  let fileSize = file.length;
  let payload = file.slice(6, fileSize);
  let offset = 0;

  if (format === WFPPayloadType.GzipB64URL)
  {
    let data = decode(payload);
    payload = await decompress(data);
  }
  
  while (offset + 6 < payload.length) {
    let chunkID: string = payload.slice(offset, offset + 4);
    let chunkLength: number = parseInt(payload.slice(offset + 4, offset + 8), 16);
    let asciiData: string = payload.slice(offset + 8, offset + 8 + chunkLength);
    let dataArray = asciiData.match(/.{1,2}/g)?.map((hex) => parseInt(hex, 16));
    let data = dataArray != undefined ? Uint8Array.from(dataArray) : new Uint8Array();
    chunks.set(chunkID, data);
    offset += 4 + 4 + chunkLength;
  }
  return chunks;
}
