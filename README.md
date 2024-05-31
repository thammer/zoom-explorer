# zoom-explorer
This repository contains tools for exploring the Zoom MS Plus series effect pedals, as well as my findings regarding MIDI-communication with these pedals.

All numeric values listed below are in hexadecimal.

## Device IDs

* 6E = Zoom MS-50G+

To get the device ID and OS version, send a MIDI Identity Request message
```
F0 7E 7F 06 01 F7
```

Responses:
> MS-50G+: F0 7E 00 06 02 52 6E 00 23 00 31 2E 31 30 F7
* Manufacturer ID: 52 (Zoom)
* Family code: 6E 00 (MS-50G+)
* Model number: 23 00
* Version number 31 2E 31 30 (System 1.10, Preset 1.00, Boot 1.00, Checksum EE8E)  

## Commands / message types

For the short 6 byte messages, the message type or command is just one byte and the format is the same as for the original MS series pedals:
```
F0 52 00 <device ID> <message type> F7
```
For the longer message types, the message type is two bytes.
```
F0 52 00 <device ID> <message type byte 1> <message type byte 2> <rest of message> F7
```

| Message type   | Length | Send | Receive | Message           | Description |
|----------------|--------|------|---------|-------------------|-------------|
| 01             |      6 | *    |         | F0 52 00 6E 01 F7 | Initiate firmware mode. WARNING: Don't do this if you don't know what you're doing! |
| 04             |      6 | *    |         | F0 52 00 6E 04 F7 | Exit firmware mode. The display will show "Completed!". Restart pedal to return to normal mode. |
| 33             |      6 | *    |         | F0 52 00 6E 33 F7 | Get current bank and program number |
| 50             |      6 | *    |         | F0 52 00 6E 50 F7 | Parameter edit enable |
| 51             |      6 | *    |         | F0 52 00 6E 51 F7 | Parameter edit disable |
| 52             |      6 | *    |         | F0 52 00 6E 52 F7 | PC mode on |
| 53             |      6 | *    |         | F0 52 00 6E 53 F7 | PC mode off |
| 64 0B          |      7 | *    | *       | F0 52 00 6E 64 0B F7 | Tuner on |
| 64 0C          |      7 | *    | *       | F0 52 00 6E 64 0C F7 | Tuner off |
| 64 13          |      7 | *    |         | F0 52 00 6E 64 13 F7 | Get current patch from edit buffer (expects a reply with message type 64 12)|
| 60 05 00       |      8 | *    |         | F0 52 00 6E 60 05 00 F7 | Flush buffer / clean data (needs more testing) |
| 64 02          |     10 | *    |         | F0 52 00 6E 64 02 00 00 00 F7 | Get display information | 
| 46 00          |     12 | *    |         | F0 52 00 6E 46 00 00 \<bank LSB\> \<bank MSB\> <\program LSB\> \<program MSB\> F7 | Download patch from given bank/proram slot |
| 64 26          |     13 |      | *       | F0 52 00 6E 64 26 00 00 \<bank LSB\> \<bank MSB\> <\program LSB\> \<program MSB\> F7 | Bank and program number |
| 64 20          |     15 | *    | *       | F0 52 00 6E 64 20 00 \<effect slot\> \<param number\> \<LSB\> \<MSB\> 00 00 00 F7 | Update (edit) parameter |
| 64 20 00 64 01 |     15 | *    | *       | F0 52 00 6E 64 20 00 64 01 \<selected effect slot number\> 00 00 00 00 F7 | Select effect slot number on pedal |
| 64 20 00 64 02 |     15 | *    | *       | F0 52 00 6E 64 20 00 64 02 \<LSB\> \<MSB\> 00 00 00 F7 | Set/get tempo (BPM) |
| 64 12          |    985 |      | *       | F0 52 00 6E 64 12 01 \<length LSB\> \<length MSB\> \<rest of message\> F7 | Patch dump, automatically sent after user changes effect for a slot, or after message type 64 13 is sent to the pedal |
| 45 00          |    989 |      | *       | F0 52 00 6E 45 00 00 \<bank LSB\> \<bank MSB\> <\program LSB\> \<program MSB\> \<length LSB\> \<length MSB\> \<rest of message\> F7 | Patch dump, automatically sent a few seconds after user changes a parameter, or after message type 46 00 is sent to the pedal |

## Needs investigating

* What are the device IDs for other MS Plus Series pedals?

* F0 52 00 6E 64 02 00 00 00 F7, Get display information, what do the different params do?
* 


## Calls and response

Some careless experimentation for 6 byte messages. It's not recommended to experiment blindly with longer messages, or you will brick your pedal.

```
F0 52 00 6E 01 F7 -> F0 52 00 6E 00 0B F7        # Enters firmware update mode
F0 52 00 6E 03 F7 -> F0 52 00 6E 00 01 F7
F0 52 00 6E 04 F7 -> F0 52 00 6E 00 00 F7        # Exits firmware update mode
F0 52 00 6E 05 F7 -> F0 52 00 6E 00 00 F7
F0 52 00 6E 07 F7 -> F0 52 00 6E 06 64 00 50 06 F7
F0 52 00 6E 09 F7 -> F0 52 00 6E 00 01 F7
F0 52 00 6E 12 F7 -> F0 52 00 6E 00 00 F7
F0 52 00 6E 28 F7 -> F0 52 00 6E 00 01 F7
F0 52 00 6E 33 F7 -> B0 00 00, B0 20 02, C0 06   # Set/Get current bank and program number
F0 52 00 6E 44 F7 -> F0 52 00 6E 43 64 00 50 06 64 00 0A 00 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 F7
F0 52 00 6E 45 F7 -> F0 52 00 6E 00 01 F7
F0 52 00 6E 46 F7 -> F0 52 00 6E 00 01 F7
F0 52 00 6E 48 F7 -> F0 52 00 6E 47 02 00 00 00 00 00 00 10 00 00 00 00 00 00 00 06 F7
F0 52 00 6E 50 F7 -> F0 52 00 6E 00 00 F7        # Parameter edit enable
F0 52 00 6E 51 F7 -> F0 52 00 6E 00 00 F7        # Parameter edit disable
F0 52 00 6E 52 F7 -> F0 52 00 6E 00 00 F7        # PC mode on
F0 52 00 6E 53 F7 -> F0 52 00 6E 00 00 F7        # PC mode off
F0 52 00 6E 55 F7 -> F0 52 00 6E 54 00 01 00 00 00 01 00 00 00 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 02 F7
F0 52 00 6E 56 F7 -> F0 52 00 6E 00 0D F7
F0 52 00 6E 57 F7 -> F0 52 00 6E 00 00 F7
F0 52 00 6E 5B F7 -> F0 52 00 6E 00 00 F7        # Factory reset. WARNING: Wipes all user patches!

F0 52 00 6e 44 00 00 00 00 F7 -> F0 52 00 6E 43 64 00 50 06 64 00 0A 00 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 F7
F0 52 00 6e 48 00 00 00 00 F7 -> F0 52 00 6E 47 02 00 00 00 00 00 00 10 00 00 00 00 00 00 00 06 F7 
F0 52 00 6e 55 00 00 00 00 F7 -> F0 52 00 6E 54 00 01 00 00 00 01 00 00 00 00 00 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 02 F7
F0 52 00 6e 64 0a 00 00 00 F7 -> F0 52 00 6E 64 09 78 00 00 00 0A 00 00 01 00 32 0F 00 07 00 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 32 32 32 64 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 F7
F0 52 00 6e 64 11 F7 -> F0 52 00 6E 64 10 0E 02 04 01 00 F7 
F0 52 00 6e 64 18 00 00 64 00 F7 -> F0 52 00 6E 64 19 01 00 00 09 00 0A 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 F7 
```

## MS-50G (Original pedal) commands

| Message type   | Length | Send | Receive | Message           | Description |
|----------------|--------|------|---------|-------------------|-------------|
| 00             |      7 |      | *       | F0 52 00 58 00 00  F7 | Acknowledge |
| 06             |      6 |      | *       | F0 52 00 58 06 <num patches LSB> <num patches MSB> <patch size LSB> <patch size MSB> F7 | Total number of patches and patch size |
| 07             |      6 | *    |         | F0 52 00 58 07 F7 | Get total number of patches and patch size (reply with message type 06) |
| 08             |    156 |      | *       | F0 52 00 58 08 00 00 \<program number\> \<length LSB\> \<length MSB\> \<patch + 5*CRC\>  F7 | Patch dump, after message type 09 is sent to the pedal. Length is for unpacked 8-bit patch data. |
| 09             |      9 | *    |         | F0 52 00 58 09 00 00 \<program number\> F7 | Download patch from given proram slot (reply with message 08) |
| 28             |    146 |      | *       | F0 52 00 58 28 \<patch\>  F7 | Patch dump, after message type 29 is sent to the pedal |
| 29             |      6 | *    |         | F0 52 00 58 29 F7 | Get current patch from edit buffer (reply with message type 28) |
| 31             |     10 | *    | *       | F0 52 00 58 31 \<effect slot\> \<param number\> \<LSB\> \<MSB\> F7 | Update (edit) parameter |
| 32             |     15 | *    |         | F0 52 00 58 32 01 00 00 \<program number\> 00 00 00 00 00 F7 | Store current (non-saved) edit patch into the given program number |
| 33             |      6 | *    |         | F0 52 00 58 33 F7 | Get current bank and program number |
| 50             |      6 | *    |         | F0 52 00 58 50 F7 | Parameter edit enable |
| 51             |      6 | *    |         | F0 52 00 58 51 F7 | Parameter edit disable |
| 60             |      6 | *    |         | F0 52 00 58 60 F7 | Unknown. Flush data? |

## Useful links

* https://github.com/mungewell/zoom-zt2/
* https://github.com/Barsik-Barbosik/Zoom-Firmware-Editor/issues/16
* https://github.com/shooking/ZoomPedalFun
* https://github.com/g200kg/zoom-ms-utility/blob/master/midimessage.md
* https://web.archive.org/web/20201031104706/https://github.com/zoom-dev/MIDIDocs

* http://midi.teragonaudio.com/tech/midispec/identity.htm

* https://github.com/shooking/ZoomPedalFun/wiki/De-re-MS-70-CDR


## Acknowledgements

* Mungewell, for very helpful input on Reddit and github
  * https://www.reddit.com/r/zoommultistomp/comments/1clsyfn/midi_sysex_for_ms_plus_series/
  * https://github.com/mungewell/zoom-zt2/issues/70
* Nomadbyte, for very helpful input on github
  * https://github.com/mungewell/zoom-zt2/issues/70