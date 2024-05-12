import { toHexString } from "./tools";

enum WFPPayloadType
{
  Unknown = "?",
  ASCII = "A",
  GzipB64 = "Z"  
}

/**
 * Support for reading and writing data in the WFP (WaveFormerPatch) format, typically containing a patch for a MIDI device in the form of MIDI sysex data.
 * 
 * At the top level, A WFP file consists of a four byte file ID (WFPA or WFPZ), a 2 byte version number (in human-readable hexadecimal ascii), and then a payload.
 * The payload can be ascii, or gzipped and base-64 encoded ascii.
 * 
 * If payload if gzipped and base-64 encoded (file ID is WFPZ), the payload should be decompressed before the contents is processed further. 
 * After decompression, the processing should be identical to the ascii encoded payload (file ID is WFPA).
 * 
 * The payload consists of one or more chunks of data. Each chunk of data has a four byte chunk ID and a four character chunk length in hexadecimal format. 
 * Both the chunk ID and the chunk length are human readable strings. 
 * The chunk data is assumed to represent 8-bit binary data as 2-character hexadecimal ascii strings. 
 * The chunk length is the number of bytes in the chunk data, which is the same as the number of characters in the data string divided by 2.
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
 *   * CRC4 = 4 byte CRC for the payload (not implemented yet)
 */

export function encodeWFP(chunks: Map<string, Uint8Array>, format: WFPPayloadType) : string
{
  let str: string = "";

  let fileID = "WFP" + format;
  let fileVersion = "01";
  let payload = "";

  for (let [id, data] of chunks)
  {
    payload += id;
    payload += toHexString(data, "");
  }

  // if format === GzipB64, encode payload

  return fileID + fileVersion + payload;
}

export function decodeWFP(file: string) : Map<string, Uint8Array>
{
  let chunks = new Map<string, Uint8Array>();
  let fileID = file.slice(0, 4);
  let WFPPayloadType = file.slice(3,4);
  let fileVersion = parseInt(file.slice(4, 6), 16);
  let fileSize = file.length;
  let offset = 6;
  // if format === GzipB64, decode payload first
  while (offset < fileSize) {
    let chunkID: string = file.slice(offset, offset + 4);
    let chunkLength: number = parseInt(file.slice(offset + 4, offset + 8));
    let asciiData: string = file.slice(offset + 8, offset + chunkLength*2);
    let dataArray = asciiData.match(/.{1,2}/g)?.map((hex) => parseInt(hex, 16));
    let data = dataArray != undefined ? Uint8Array.from(dataArray) : new Uint8Array();
    chunks.set(chunkID, data);
    offset += 4 + 4 + chunkLength;
  }
  return chunks;
}
