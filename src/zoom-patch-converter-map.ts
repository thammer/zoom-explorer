/*
  Maps between MSOG patch IDs and MS+ patch IDs

  cat msplus-to-msog-effect-mapping.csv | sed -e 's/0x//g' | cut -d, -f 1,2,5,4 | grep -v ",," | sed -e 's/\([^,]*\),\([^,]*\),\([^,]*\),\([^,]*\)/  "\1": {\n    msogName:   "\2",\n    msplusName: "\3",\n    msplusID:   "\4",\n  },/g' > patchMapObj.json
*/

let patchMapObj = {
  "ID MSOG": {
    msogName:   "Name MSOG",
    msplusName: "Name MS+",
    msplusID:   "ID MS+",
  },
  "01000035": {
    msogName:   "160 Comp",
    msplusName: "160Comp",
    msplusID:   "01000048",
  },
  "02000095": {
    msogName:   "A-Filter",
    msplusName: "A-Filter",
    msplusID:   "02000025",
  },
  "08000170": {
    msogName:   "A-Pan DLY",
    msplusName: "A-PanDLY",
    msplusID:   "080000e1",
  },
  "060001f0": {
    msogName:   "ANA234Cho",
    msplusName: "AnalogCho",
    msplusID:   "06000051",
  },
  "09000070": {
    msogName:   "Air",
    msplusName: "AirReverb",
    msplusID:   "090000c1",
  },
  "09000110": {
    msogName:   "Ambience",
    msplusName: "Ambience",
    msplusID:   "090000a1",
  },
  "08000030": {
    msogName:   "AnalogDly",
    msplusName: "AnalogDly",
    msplusID:   "08000021",
  },
  "09000050": {
    msogName:   "Arena",
    msplusName: "Arena",
    msplusID:   "09000098",
  },
  "07000050": {
    msogName:   "AutoPan",
    msplusName: "AutoPan",
    msplusID:   "07000011",
  },
  "02000050": {
    msogName:   "AutoWah",
    msplusName: "AutoWah",
    msplusID:   "02000010",
  },
  "060001b0": {
    msogName:   "BF FLG 2",
    msplusName: "BF_Flanger2",
    msplusID:   "060000fa",
  },
  "06000078": {
    msogName:   "Ba Chorus",
    msplusName: "BaChorus",
    msplusID:   "06000057",
  },
  "0200009a": {
    msogName:   "Ba Cry",
    msplusName: "BassCry",
    msplusID:   "02000048",
  },
  "06000088": {
    msogName:   "Ba Detune",
    msplusName: "BaDetune",
    msplusID:   "06000085",
  },
  "060000b8": {
    msogName:   "Ba Ensmbl",
    msplusName: "Ba_Ensmbl",
    msplusID:   "0600005c",
  },
  "02000018": {
    msogName:   "Ba GEQ",
    msplusName: "BassGEQ",
    msplusID:   "020000d4",
  },
  "06000118": {
    msogName:   "Ba Octave",
    msplusName: "BaOctaver",
    msplusID:   "06000138",
  },
  "02000024": {
    msogName:   "Ba PEQ",
    msplusName: "BassPEQ",
    msplusID:   "020000dc",
  },
  "06000138": {
    msogName:   "Ba Pitch",
    msplusName: "PolyShift",
    msplusID:   "06000171",
  },
  "02000058": {
    msogName:   "BaAutoWah",
    msplusName: "BassA-Wah",
    msplusID:   "02000035",
  },
  "060000e8": {
    msogName:   "BaFlanger",
    msplusName: "BaFlanger",
    msplusID:   "060000ea",
  },
  "06000150": {
    msogName:   "BendCho",
    msplusName: "BendCho",
    msplusID:   "06000071",
  },
  "07000010": {
    msogName:   "BitCrush",
    msplusName: "BitCrush",
    msplusID:   "07000050",
  },
  "07000020": {
    msogName:   "Bomber",
    msplusName: "Bomber",
    msplusID:   "07000040",
  },
  "0200002c": {
    msogName:   "Bottom B",
    msplusName: "BottomB",
    msplusID:   "020000f0",
  },
  "06000180": {
    msogName:   "CE-Cho5",
    msplusName: "CE_Cho5",
    msplusID:   "06000056",
  },
  "09000100": {
    msogName:   "Cave",
    msplusName: "CaveReverb",
    msplusID:   "09000140",
  },
  "090000d0": {
    msogName:   "Chamber",
    msplusName: "Chamber",
    msplusID:   "090000b1",
  },
  "06000070": {
    msogName:   "Chorus",
    msplusName: "Chorus",
    msplusID:   "06000011",
  },
  "090000f0": {
    msogName:   "Church",
    msplusName: "ChurchREV",
    msplusID:   "09000091",
  },
  "06000190": {
    msogName:   "CloneCho",
    msplusName: "CloneCho",
    msplusID:   "06000020",
  },
  "02000040": {
    msogName:   "CombFLTR",
    msplusName: "CombFilter",
    msplusID:   "02000095",
  },
  "01000008": {
    msogName:   "Comp",
    msplusName: "Comp",
    msplusID:   "01000010",
  },
  "060001e0": {
    msogName:   "CoronaCho",
    msplusName: "CoronaCho",
    msplusID:   "06000038",
  },
  "06000200": {
    msogName:   "CoronaTri",
    msplusName: "TriChorus",
    msplusID:   "06000041",
  },
  "02000070": {
    msogName:   "Cry",
    msplusName: "CryFilter",
    msplusID:   "02000040",
  },
  "08000008": {
    msogName:   "Delay",
    msplusName: "Delay",
    msplusID:   "08000011",
  },
  "06000080": {
    msogName:   "Detune",
    msplusName: "Detune",
    msplusID:   "06000081",
  },
  "01000070": {
    msogName:   "DirtyGate",
    msplusName: "DirtyGate",
    msplusID:   "01000088",
  },
  "08000100": {
    msogName:   "DriveEcho",
    msplusName: "DriveEcho",
    msplusID:   "080000d8",
  },
  "010000a0": {
    msogName:   "DualComp",
    msplusName: "DualComp",
    msplusID:   "01000055",
  },
  "080000e0": {
    msogName:   "DualDigiD",
    msplusName: "DualDelay",
    msplusID:   "08000051",
  },
  "090001c0": {
    msogName:   "DualRev",
    msplusName: "DualReverb",
    msplusID:   "090001c0",
  },
  "06000035": {
    msogName:   "DuoPhase",
    msplusName: "DuoPhase",
    msplusID:   "060000d0",
  },
  "06000010": {
    msogName:   "DuoTrem",
    msplusName: "DuoTrem",
    msplusID:   "06000098",
  },
  "08000060": {
    msogName:   "DynaDelay",
    msplusName: "DynaDelay",
    msplusID:   "080000f8",
  },
  "060000f0": {
    msogName:   "DynaFLNGR",
    msplusName: "DynaFLNGR",
    msplusID:   "06000108",
  },
  "09000170": {
    msogName:   "DynaRev",
    msplusName: "DynaReverb",
    msplusID:   "09000190",
  },
  "09000060": {
    msogName:   "EarlyRef",
    msplusName: "EarlyRef",
    msplusID:   "090000d1",
  },
  "09000140": {
    msogName:   "Echo",
    msplusName: "EchoReverb",
    msplusID:   "09000160",
  },
  "060000b0": {
    msogName:   "Ensemble",
    msplusName: "Ensemble",
    msplusID:   "06000059",
  },
  "02000030": {
    msogName:   "Exciter",
    msplusName: "Exciter",
    msplusID:   "020000e0",
  },
  "08000160": {
    msogName:   "FLTR PPD",
    msplusName: "FilterPPD",
    msplusID:   "080000b5",
  },
  "08000070": {
    msogName:   "FilterDly",
    msplusName: "FilterDly",
    msplusID:   "080000b1",
  },
  "060000e0": {
    msogName:   "Flanger",
    msplusName: "Flanger",
    msplusID:   "060000e5",
  },
  "09000120": {
    msogName:   "GateRev",
    msplusName: "GateRevrb",
    msplusID:   "090000e1",
  },
  "02000010": {
    msogName:   "GraphicEQ",
    msplusName: "GtGEQ",
    msplusID:   "020000a0",
  },
  "01000090": {
    msogName:   "GrayComp",
    msplusName: "GrayComp",
    msplusID:   "01000030",
  },
  "09000008": {
    msogName:   "HD Hall",
    msplusName: "HDHall",
    msplusID:   "09000081",
  },
  "0900000c": {
    msogName:   "HD Reverb",
    msplusName: "HDHall",
    msplusID:   "09000081",
  },
  "06000140": {
    msogName:   "HPS",
    msplusName: "HPS",
    msplusID:   "06000161",
  },
  "09000010": {
    msogName:   "Hall",
    msplusName: "HallREV",
    msplusID:   "09000061",
  },
  "09000160": {
    msogName:   "HolyFLERB",
    msplusName: "HolyReverb",
    msplusID:   "09000180",
  },
  "08000180": {
    msogName:   "ICE Delay",
    msplusName: "ICEDelay",
    msplusID:   "08000101",
  },
  "08000130": {
    msogName:   "LO-FI Dly",
    msplusName: "LoFiDelay",
    msplusID:   "080000ba",
  },
  "090000e0": {
    msogName:   "LOFI Rev",
    msplusName: "LO-FIRever",
    msplusID:   "09000130",
  },
  "0100003a": {
    msogName:   "Limiter",
    msplusName: "Limiter",
    msplusID:   "01000065",
  },
  "02000008": {
    msogName:   "LineSel",
    msplusName: "LineSel",
    msplusID:   "07000f00",
  },
  "01000020": {
    msogName:   "M Comp",
    msplusName: "RackComp",
    msplusID:   "01000020",
  },
  "090001b0": {
    msogName:   "MangledSp",
    msplusName: "MangledSpa",
    msplusID:   "090001b0",
  },
  "060001d0": {
    msogName:   "MirageCho",
    msplusName: "MirageCho",
    msplusID:   "0600007a",
  },
  "08000020": {
    msogName:   "ModDelay",
    msplusName: "ModDelay",
    msplusID:   "080000a1",
  },
  "08000028": {
    msogName:   "ModDelay2",
    msplusName: "ModDelay2",
    msplusID:   "080000a8",
  },
  "090000a0": {
    msogName:   "ModReverb",
    msplusName: "ModReverb",
    msplusID:   "09000120",
  },
  "06000160": {
    msogName:   "MojoRolle",
    msplusName: "SwellVibe",
    msplusID:   "06000120",
  },
  "06000130": {
    msogName:   "MonoPitch",
    msplusName: "PolyShift",
    msplusID:   "06000171",
  },
  "07000030": {
    msogName:   "MonoSynth",
    msplusName: "MonoSynth",
    msplusID:   "07000060",
  },
  "08000050": {
    msogName:   "MultiTapD",
    msplusName: "MultiTapD",
    msplusID:   "08000058",
  },
  "01000060": {
    msogName:   "NoiseGate",
    msplusName: "NoiseGate",
    msplusID:   "01000080",
  },
  "06000110": {
    msogName:   "Octave",
    msplusName: "Octaver",
    msplusID:   "06000131",
  },
  "01000030": {
    msogName:   "OptComp",
    msplusName: "OptComp",
    msplusID:   "01000040",
  },
  "01000080": {
    msogName:   "OrangeLim",
    msplusName: "OrangeLimi",
    msplusID:   "0100006a",
  },
  "02000020": {
    msogName:   "ParaEQ",
    msplusName: "ParaEQ",
    msplusID:   "020000d0",
  },
  "09000190": {
    msogName:   "ParticleR",
    msplusName: "ParticleR",
    msplusID:   "09000111",
  },
  "080000a0": {
    msogName:   "PhaseDly",
    msplusName: "PhaseDly",
    msplusID:   "080000d1",
  },
  "06000030": {
    msogName:   "Phaser",
    msplusName: "Phaser",
    msplusID:   "060000a1",
  },
  "08000080": {
    msogName:   "PitchDly",
    msplusName: "PitchDLY",
    msplusID:   "080000c1",
  },
  "06000120": {
    msogName:   "PitchSHFT",
    msplusName: "PolyShift",
    msplusID:   "06000171",
  },
  "09000090": {
    msogName:   "Plate",
    msplusName: "PlateREV",
    msplusID:   "09000051",
  },
  "01000010": {
    msogName:   "RackComp",
    msplusName: "RackComp",
    msplusID:   "01000020",
  },
  "02000060": {
    msogName:   "Resonance",
    msplusName: "ResoFLTR",
    msplusID:   "02000020",
  },
  "08000040": {
    msogName:   "ReverseDL",
    msplusName: "ReverseDL",
    msplusID:   "08000091",
  },
  "09000130": {
    msogName:   "ReverseRv",
    msplusName: "ReverseRev",
    msplusID:   "09000150",
  },
  "06000170": {
    msogName:   "RingMod",
    msplusName: "RingMod",
    msplusID:   "06000190",
  },
  "020000c0": {
    msogName:   "RndmFLTR",
    msplusName: "RndmFLTR",
    msplusID:   "02000080",
  },
  "09000020": {
    msogName:   "Room",
    msplusName: "RoomREV",
    msplusID:   "09000011",
  },
  "07000060": {
    msogName:   "Rt Closet",
    msplusName: "RtCloset",
    msplusID:   "07000080",
  },
  "020000b0": {
    msogName:   "SeqFLTR",
    msplusName: "SeqFLTR",
    msplusID:   "02000070",
  },
  "09000180": {
    msogName:   "ShimmerRv",
    msplusName: "ShimmerRev",
    msplusID:   "090001a0",
  },
  "060001c0": {
    msogName:   "SilkyCho",
    msplusName: "SilkyCho",
    msplusID:   "06000075",
  },
  "090000b0": {
    msogName:   "SlapBack",
    msplusName: "SlapBackR",
    msplusID:   "090000d8",
  },
  "08000110": {
    msogName:   "SlapBackD",
    msplusName: "SlapBackD",
    msplusID:   "08000071",
  },
  "06000020": {
    msogName:   "Slicer",
    msplusName: "Slicer",
    msplusID:   "060001a1",
  },
  "01000040": {
    msogName:   "SlowATTCK",
    msplusName: "SlowATTCK",
    msplusID:   "01000090",
  },
  "02000080": {
    msogName:   "SlowFLTR",
    msplusName: "SlowFLTR",
    msplusID:   "0200009a",
  },
  "08000140": {
    msogName:   "SlwAtkDly",
    msplusName: "SlwAtkDly",
    msplusID:   "080000f1",
  },
  "08000120": {
    msogName:   "SmoothDly",
    msplusName: "SmoothDly",
    msplusID:   "08000068",
  },
  "090001a0": {
    msogName:   "SpaceHole",
    msplusName: "SpaceHole",
    msplusID:   "09000101",
  },
  "02000028": {
    msogName:   "Splitter",
    msplusName: "Splitter",
    msplusID:   "02000110",
  },
  "09000040": {
    msogName:   "Spring",
    msplusName: "SpringREV",
    msplusID:   "09000031",
  },
  "090000c0": {
    msogName:   "Spring63",
    msplusName: "SpringReve",
    msplusID:   "09000036",
  },
  "02000100": {
    msogName:   "St Bs GEQ",
    msplusName: "StBaGEQ",
    msplusID:   "020000d8",
  },
  "020000e0": {
    msogName:   "St Gt GEQ",
    msplusName: "StGtGEQ",
    msplusID:   "020000c0",
  },
  "020000a0": {
    msogName:   "Step",
    msplusName: "StepFLTR",
    msplusID:   "02000090",
  },
  "060000a0": {
    msogName:   "StereoCho",
    msplusName: "StereoCho",
    msplusID:   "06000061",
  },
  "08000090": {
    msogName:   "StereoDly",
    msplusName: "StereoDly",
    msplusID:   "0800007a",
  },
  "080000c0": {
    msogName:   "StompDly",
    msplusName: "StompDly",
    msplusID:   "08000075",
  },
  "060001a0": {
    msogName:   "StonePha",
    msplusName: "StonePha",
    msplusID:   "060000b0",
  },
  "060000d0": {
    msogName:   "SuperCho",
    msplusName: "ChorusOne",
    msplusID:   "06000031",
  },
  "00000000": {
    msogName:   "THRU",
    msplusName: "THRU",
    msplusID:   "00000000",
  },
  "08000010": {
    msogName:   "TapeEcho",
    msplusName: "TapeEcho",
    msplusID:   "08000031",
  },
  "080000d0": {
    msogName:   "TapeEcho3",
    msplusName: "TapeEcho3",
    msplusID:   "08000041",
  },
  "06000040": {
    msogName:   "TheVibe",
    msplusName: "TheVibe",
    msplusID:   "060000e1",
  },
  "09000030": {
    msogName:   "TiledRoom",
    msplusName: "TiledRoom",
    msplusID:   "09000028",
  },
  "08000150": {
    msogName:   "TremDelay",
    msplusName: "TremDelay",
    msplusID:   "080000c8",
  },
  "06000008": {
    msogName:   "Tremolo",
    msplusName: "Tremolo",
    msplusID:   "0600008a",
  },
  "09000150": {
    msogName:   "TremoloRv",
    msplusName: "TremoloRev",
    msplusID:   "09000170",
  },
  "080000b0": {
    msogName:   "TrgHldDly",
    msplusName: "TrgHldDly",
    msplusID:   "08000120",
  },
  "06000100": {
    msogName:   "Vibrato",
    msplusName: "Vibrato",
    msplusID:   "06000111",
  },
  "060000d8": {
    msogName:   "VinFLNGR",
    msplusName: "VinFLNGR",
    msplusID:   "060000f1",
  },
  "06000090": {
    msogName:   "VintageCE",
    msplusName: "VintageCE",
    msplusID:   "06000053",
  },
  "0600003a": {
    msogName:   "WarpPhase",
    msplusName: "WarpPhase",
    msplusID:   "060000c0",
  },
  "02000088": {
    msogName:   "Z Tron",
    msplusName: "ZTronFLT",
    msplusID:   "0200002a",
  },
  "07000040": {
    msogName:   "Z-Organ",
    msplusName: "Z-Organ",
    msplusID:   "07000070",
  },
  "01000050": {
    msogName:   "ZNR",
    msplusName: "ZNR",
    msplusID:   "01000070",
  },
  "020000d0": {
    msogName:   "fCycle",
    msplusName: "LFOFLTR",
    msplusID:   "02000060",
  },
}  

let zoomPatchConverterMap = new Map<number, any>(Object.entries(patchMapObj).map(([key, value]) => {
  (value as any).msplusID = parseInt(value.msplusID, 16); 
  return [parseInt(key, 16), value as any];
}));

export default zoomPatchConverterMap; 