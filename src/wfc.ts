import { toHexString } from "./tools.js";

export enum WFCFormatType
{
  Unknown = "?",
  ASCII = "A",
  ASCIICompressed = "E",
  Binary = "B",
  BinaryCompressed = "C",
}

/**
 * Support for reading and writing data in the WFC (WaveFormerChunked) format, typically used for MIDI sysex data.
 * 
 * This is very much a work in progress, still at the brainstorming stage
 * 
 * The format can be ASCII or Binary, and the data can optionally be compressed and base64 encoded.
 * 
 * ASCII
 *   - Unencoded ASCII is humanry readable and easy to copy and paste.
 *   - Compressed binary data encoded to ASCII with Base64URL is more compact, easy to copy and paste, and compatible with being a part of an URL.
 *
 * Binary
 *   - Compressed binary is suitable for storing in files when it is not important to be humanly readable and not important to copy and paste as text.
 * 
 * The format is not designed to be edited in a text editor, as it has a strict form with Chunk IDs and Chunk sizes which would be impractical to 
 * keep consistent in a text editor.
 *  
 * At the top level, A WFP file consists of a four byte file ID (WFPA or WFPZ), a 2 byte version number (in human-readable hexadecimal ascii), and then a payload.
 * The payload can be ascii, or gzipped and base-64-urlL encoded ascii.
 * 
 * If payload if gzipped and base-64-url encoded (file ID is WFPZ), the payload should be decompressed before the contents is processed further. 
 * After decompression, the processing should be identical to the ascii encoded payload (file ID is WFPA).
 * 
 * The payload consists of one or more chunks of data. Each chunk of data has a four byte chunk ID and a four character chunk size in hexadecimal format. 
 * Both the chunk ID and the chunk size are human readable strings. 
 * The chunk data would normally represent 8-bit binary data as 2-character hexadecimal ascii strings, 
 * however in there is nothing in the file format that prevents chunks to contain other types of data, like regular text strings. 
 * The chunk size is the number of characters in the data string.
 * 
 * <chunk ID> <chunk size> <chunk data>
 * 
 * Example: A WFP file with one chunk of data with ID "ABCD" and 6 bytes (12 characters) of 
 * data (Decimal: 0, 5, 10, 15, 20, 25. Hexadecimal: 00, 05, 0A, 0F, 14, 19) would be represented as:
 *   "WFPA01ABCD001200050A0F1419". With spaces inserted for clarity (but shouldn't be in actual data): "WFPA 01 ABCD 0012 00050A0F1419"   
 *
 * Chunk IDs:
 *   * Sysex chunk ID starts with S, and the last letter is T for transmit and R for receive. The two middle characters says something about the type of content.
 *   * SIDR = Sysex ID Reply, the sysex message received from the device after sending the MIDI ID request command, F0 7E 7F 06 01 F7
 *   * SPQT = Sysex patch request command 
 *   * SPRR = Sysex patch response, includes all the patch data
 *   * SPST = Sysex patch send (???) Perhaps nice to let the program to send the patch know how to send it? Then the program doesn't need to know which device it's for ???
 *            or how to send patches to such a device. Something to think about...
 * 
 * There will probably be other chunk IDs in the future, and some of those ChunkIDs might indicate that the
 * chunk data is ascii or unicode, and not hexadecimal ascii strings.
 * 
 * For ASCII format, the first character of the chunk ID could decide if contents is text or hex,
 * Example: TINF = text informaion, to be read as individual ascii characters with one character per byte, not as hex text with two characters per byte
 * 
 * For binary format, the name of the chunk doesn't affect how the data is read.
 * 
 * Some brainstorming below, to be cleaned up
 * 
 * 
 * Chunk ID = 4 character code
 * Chunk size takes up four bytes, and follows the same logic as for file size. 
 *   If the file type is ASCII, the size is four characters representing hexadecimal number, the number of characters to follow for this chunk.
 *   This means that the maximum chunk data size for ASCII files is 64k characters, corresponding to 32k bytes of data (since each byte is written as hexadecimal)
 * 
 * There can be multiple chunks with the same name. The data parser should keep the order intact, as an array of data with the same chunk ID.
 * 
 * Useful chunks:
 *   - TFIN = Text, File INfo, as key-value pairs
 *   - TPIN = Text Patch INfo, one TPIN for each SPRX (patch response)
 *   - TCIN = Text, Chunk info, support multiple chunks with same name?
 *   - TDIR = Text, chunk directory, some info about multiple chunks with same name?
 *  
 * 
 *   Formats
 * 
 *     WFCA = ASCII Plain, unencoded - humanly readable, easy to copy and paste
 *     WFCE = ASCII Compressed and Encoded, gzip compressed binary and Base64URL encoded as ASCII, easy to copy and paste
 *     WFCB = binary - typically used for files, but the binary gzipped version is recommended
 *     WFCC = binary, gzipped - typically used for files
 *     WFCX = new versions of the format can be defined later, with a unique letter
 * 
 *   - "A" ASCII Plain 
 * 
 *         WFCA 0020 ABCD 0016 01 02 03 04 05 ...
 *         ^^^^ ^^^^ ^^^^ ^^^^ ^^
 *         |    |    |    |    +-------- Chunk data starts here, 2 and 2 characters are the byte value in hexadecimal
 *         |    |    |    +------------- Chunk size
 *         |    |    +------------------ Chunk ID
 *         |    +----------------------- File size is a 4 character hex string. It is the overall file size minus 8 bytes.
 *         +---------------------------- 4 byte file format identifier, WaveFormer Chunked ASCII
 * 
 *   - "E" ASCII Compressed and Encoded  
 * 
 *         WFCB 0020 d873gkd...
 *         ^^^^ ^^^^ ^^^^^^^^^^
 *         |    |    +------------------ Payload starts here, binary data is compressed and Base64URL encoded as ASCII, with chunk ids, sizes and data 
 *         |    +----------------------- File size is a 4 character hex string. It is the overall file size minus 8 bytes.
 *         +---------------------------- 4 byte file format identifier, WaveFormer Chunked gzipped binary base64url Encoded
 * 
 *   - "B" Binary
 * 
 *         WFCC BBBB ABCD BBBB XXXXX...
 *         ^^^^ ^^^^ ^^^^ ^^^^ ^^^^^
 *         |    |    |    |    +-------- Chunk data starts here
 *         |    |    |    +------------- Chunk size as unsigned little-endian 32-bit integer, size does not include the size of the ChunkID and the size field
 *         |    |    +------------------ Chunk ID
 *         |    +----------------------- File size is a (4-byte) unsigned 32-bit integer
 *         +---------------------------- 4 byte file format identifier, WaveFormer Chunked Binary
 * 
 *   - "C" Binary Compressed
 * 
 *         WFCC BBBB a?9#$...
 *         ^^^^ ^^^^ ^^^^^ 
 *         |    |    +------------------ Payload starts here, binary data is compressed with gzip
 *         |    +----------------------- File size is a (4-byte) unsigned little-endian 32-bit integer
 *         +---------------------------- 4 byte file format identifier, WaveFormer Chunked Compressed binary
 * 
 * 
 */


// https://evanhahn.com/javascript-compression-streams-api-with-strings/
// https://dev.to/ternentdotdev/json-compression-in-the-browser-with-gzip-and-the-compression-streams-api-4135

async function compressString(str: string) : Promise<Uint8Array> 
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

async function compressBytes(bytes: Uint8Array) : Promise<Uint8Array> 
{
  const stream = new Blob([bytes]).stream();
  const compressedStream = stream.pipeThrough(
    new CompressionStream("gzip")
  );

  const compressedResponse = new Response(compressedStream);
  const blob = await compressedResponse.blob();
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

async function decompressString(data: Uint8Array) : Promise<string>
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

async function decompressBytes(data: Uint8Array) : Promise<Uint8Array>
{
  const stream = new Blob([data], {
    type: "application/json",
  }).stream();

  const compressedReadableStream = stream.pipeThrough(
    new DecompressionStream("gzip")
  );

  const resp = new Response(compressedReadableStream);
  const blob = await resp.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return bytes;
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

function setChunkID(chunkID: string, data: Uint8Array, offset: number)
{
  data[offset]     = chunkID.charCodeAt(0);
  data[offset + 1] = chunkID.charCodeAt(1);
  data[offset + 2] = chunkID.charCodeAt(2);
  data[offset + 3] = chunkID.charCodeAt(3);
}

function getChunkID(data: Uint8Array, offset: number) : string
{
  return String.fromCharCode(data[offset]) + String.fromCharCode(data[offset + 1]) +
    String.fromCharCode(data[offset + 2]) + String.fromCharCode(data[offset + 3]);
}


function setChunkLength(chunkLength: number, data: Uint8Array, offset: number)
{
  data[offset]     = 0xFF & chunkLength;
  data[offset + 1] = 0xFF & (chunkLength >> 8);
  data[offset + 2] = 0xFF & (chunkLength >> 16);
  data[offset + 3] = 0xFF & (chunkLength >> 24);
}

function getChunkLength(data: Uint8Array, offset: number) : number
{
  return data[offset] + (data[offset + 1] << 8) + (data[offset + 2] << 16) + (data[offset + 3] << 24);
}

export async function encodeWFCToString(chunks: Map<string, Array<Uint8Array>>, format: WFCFormatType) : Promise<string>
{
  let fileID = "WFP" + format;
  let payload = "";

  if (format === WFCFormatType.ASCII)
  {
    for (let [id, dataArray] of chunks)
    {
      for (let i=0; i<dataArray.length; i++) 
      {
        let data = dataArray[i];
        let hex = toHexString(data);
        if (hex.length > 0xFFFF) {
          hex = hex.slice(0, 0xFFFF);
          console.warn(`encodeWFP cannot encode more than ${0xFFFF/2} bytes in one chunk`);
        }
        let length = hex.length.toString(16).toUpperCase().padStart(4, "0");
        payload += id + length + hex;
      }
    }
  } 
  else if (format === WFCFormatType.ASCIICompressed) 
  {
    let uncompressedPayloadLength = 0;

    for (let [id, dataArray] of chunks)
        for (let i=0; i<dataArray.length; i++) 
          uncompressedPayloadLength += 4 + 4 + dataArray[i].length;
    
    let binaryPayload = new Uint8Array(uncompressedPayloadLength);
    let payloadOffset = 0;
    for (let [id, dataArray] of chunks)
    {
      for (let i=0; i<dataArray.length; i++) 
      {
        let data = dataArray[i];
        setChunkID(id, binaryPayload, payloadOffset); payloadOffset += 4;
        setChunkLength(data.length, binaryPayload, payloadOffset); payloadOffset += 4;
        binaryPayload.set(data, payloadOffset); payloadOffset += data.length;
      }
    }

    let compressedPayload = await compressBytes(binaryPayload);
    let encodedPayload = encode(compressedPayload); 
    payload = encodedPayload;
  }

  let payloadSize = payload.length.toString(16).toUpperCase().padStart(4, "0");
  return fileID + payloadSize + payload;
}

export async function decodeWFCFromString(file: string) : Promise<Map<string, Array<Uint8Array>>>
{
  let chunks = new Map<string, Array<Uint8Array>>();
  let fileID = file.slice(0, 4);
  let format = file[3] as WFCFormatType;
  let payloadSize = parseInt(file.slice(4, 8), 16);
  if (payloadSize + 8 > file.length) {
    console.error(`File size stored in file plus 8 bytes (${payloadSize} + 8) is larger than actual file size (${file.length}). Is the file truncated? Bailing out.`);
    return chunks;
  }
  else if (payloadSize + 8 < file.length) {
    console.error(`File size stored in file plus 8 bytes (${payloadSize} + 8) is smaller than actual file size (${file.length}). Ignoring unknown data at the end of file.`);
  }
  
  if (format === WFCFormatType.ASCII) {
    let payload = file.slice(8, 8 + payloadSize);
    let offset = 0;
    while (offset + 8 <= payload.length) {
      let chunkID: string = payload.slice(offset, offset + 4);
      let chunkSize: number = parseInt(payload.slice(offset + 4, offset + 8), 16);
      let asciiData: string = payload.slice(offset + 8, offset + 8 + chunkSize);
      let dataArray = asciiData.match(/.{1,2}/g)?.map((hex) => parseInt(hex, 16));
      let data = dataArray != undefined ? Uint8Array.from(dataArray) : new Uint8Array();
      let chunk = chunks.get(chunkID);
      if (chunk === undefined) {
        chunk = new Array<Uint8Array>();
        chunks.set(chunkID, chunk);
      }
      chunk.push(data);
      offset += 4 + 4 + chunkSize;
    }
  }  
  else if (format === WFCFormatType.ASCIICompressed) {
    let encodedPayload = file.slice(8, 8 + payloadSize);
    let compressedPayload = decode(encodedPayload);
    let binaryPayload = await decompressBytes(compressedPayload);
    let offset = 0;
    while (offset + 8 < binaryPayload.length) {
      let chunkID: string = getChunkID(binaryPayload, offset);
      let chunkSize: number = getChunkLength(binaryPayload, offset + 4);
      let data = binaryPayload.slice(offset + 8, offset + 8 + chunkSize);
      let chunk = chunks.get(chunkID);
      if (chunk === undefined) {
        chunk = new Array<Uint8Array>();
        chunks.set(chunkID, chunk);
      }
      chunk.push(data);
      offset += 4 + 4 + chunkSize;
    }
  }
  else {
    console.error(`Cannot decode format "${format}" from string. Bailing out.`)
    return chunks;
  }

  return chunks;
}
