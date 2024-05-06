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

### Short messages (6 bytes)
For the short 6 byte messages, the message type or command is just one byte and the format is the same as for the original MS series pedals:
```
F0 52 00 <device ID> <message type> F7
```

| Message type | Message | Description |
|--------------|---------|-------------|
|50            | F0 52 00 6E 50 F7 | Parameter edit enable |
|51            | F0 52 00 6E 51 F7 | Parameter edit disable |

### Long messages (13 bytes and longer)

For messages of length 13 bytes and up, the message type is two bytes

```
F0 52 00 <device ID> <message type byte 1> <message type byte 2> <rest of message> F7
```

| Message type | Length | Message | Description |
|--------------|--------|---------|-------------|
| 45 00        | 989    | F0 52 00 6E 45 00 \<rest of message\> F7 | Patch dump
| 64 12        | 985    |F0 52 00 6E 64 12 \<rest of message\> F7 | Change effect for a slot |
| 64 26        | 13     |F0 52 00 6E 64 26   00 00 \<bank\> 00 \<program\> 00 F7 | Bank and program number |
| 64 20        | 15     |F0 52 00 6E 64 20 00 \<effect slot\> \<param number\> \<LSB\> \<MSB\> 00 00 00 F7 | Update (edit) parameter |
| 64 20        | 15     |F0 52 00 6E 64 20 00 64 01 \<selected effect slot number\> 00 00 00 00 F7 | Select effect slot number on pedal |

## Remaining mysteries

* What are the device IDs for other MS Plus Series pedals?
* How do you send an effect patch to the pedal?
* How is the effect patch checksum calculated (last 5 bytes in a patch sysex message) ?


## Collection of Sysex messages sent by MS Plus Series pedals

```
F0 7E 00 06 02 52 6E 00 23 00 31 2E 31 30 F7       Length: 15   MIDI Identity Response

F0 52 00 6E   00 00   F7                           Length: 7    When and why are the MS+ pedals sending this? 
F0 52 00 6E   45 00   <rest of message>            Length: 989  Patch dump?
F0 52 00 6E   64 26   00 00 08 00 04 00 F7         Length: 13   Bank and program number
F0 52 00 6E   64 20   00 00 05 33  00 00 00 00 F7  Length: 15   Parameter updated
F0 52 00 6E   64 20   00 64 01 04  00 00 00 00 F7  length: 15   Pressed arrow right or left to select current effect slot. 
                                                                data[7] == 0x64, data[8] == 0x01, data[9] = current effect slot number 
F0 52 00 6E   64 12   <rest of message>            Length: 985  Effect slot effect changed? Very similar to patch dump message (45 00)  


```

## Useful links

* https://github.com/g200kg/zoom-ms-utility/blob/master/midimessage.md
* http://midi.teragonaudio.com/tech/midispec/identity.htm
