# zoom-explorer
This repository contains tools for exploring the Zoom MS Plus series effect pedals, as well as my findings regarding MIDI-communication with these pedals.

## Device IDs

* 0x6E = Zoom MS-50G+

To get the device ID and OS version, send a MIDI Identity Request message
```
[0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7]
```

Responses:
> MS-50G+: F0 7E 00 06 02 52 6E 00 23 00 31 2E 31 30 F7
* Manufacturer ID: 0x52 (Zoom)
* Family code: 6E 00 (MS-50G+)
* Model number: 23 00
* Version number 31 2E 31 30 (System 1.10, Preset 1.00, Boot 1.00, Checksum EE8E)  

## Commands

It looks like the command format is the same as for the original MS series of pedals, and probably the command codes as well.
```
[0xF0, 0x52, 0x00, <device ID>, <command>, 0x42, 0xF7]
```
Enable parameter edit: command code 0x50
```
[0xF0, 0x52, 0x00, 0x6E, 0x50, 0x42, 0xF7]
```

## Editing parameters

```
[0xF0, 0x52, 0x00, 0x6E, 0x64, 0x20, 0x00, <effect slot>, <param number>, <LSB>, <MSB>, 0x00, 0x00, 0x00, 0xF7]
```

## Useful links

* https://github.com/g200kg/zoom-ms-utility/blob/master/midimessage.md
* http://midi.teragonaudio.com/tech/midispec/identity.htm
