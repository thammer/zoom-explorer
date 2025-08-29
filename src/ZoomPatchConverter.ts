import { LogLevel, shouldLog } from "./Logger.js";
import zoomPatchConverterMap from "./zoom-patch-converter-map.js";
import { EffectParameterMap, ParameterValueMap, ZoomDevice } from "./ZoomDevice.js";
import { EffectSettings, PTCF_EDTB_REVERSED_BYTES_SIZE, ZoomPatch } from "./ZoomPatch.js";


export class ZoomPatchConverter
{

  private patchConverterMap: Map<number, any>; // FIXME: Use proper type instead of any

  // Maps from parameter name in input effect to parameter name in output effect
  // This has precedence over matching parameter names in the output effect, in case the output effect
  // already has a parameter of the same name as the input effect parameter name
  private parameterMapObj = {
    "ABMix" : "A-B Mix",
    "Bal"   : "Mix",
    "BITS"  : "Bit",
    "ChMix" : "CHO Mix",
    "DCY A" : "Decay A",
    "DCY B" : "Decay B",
    "Deay"  : "Decay",
    "DlyMx" : "DLY Mix",
    "DPT_A" : "Depth A",
    "DPT_B" : "Depth B",
    "DRBal" : "D-R BAL",
    "DRCTN" : "Mode",
    "DRV"   : "DRY",
    "DWELL" : "Decay",
    "E.LVL" : "Mix",
    "EFX_L" : "EFX LVL",
    "EQ"    : "Tone",
    "F.B"   : "Repeat",
    "Fdbk"  : "Repeat",
    "FdbkA" : "REP A",
    "FdbkB" : "REP B",
    "FLT"   : "Filter",
    "FLTR"  : "Filter",
    "Freq1" : "FREQ",
    "FxLVL" : "Mix",
    "Gain1" : "Gain",
    "HiDMP" : "HI-DMP",
    "HIGH"  : "HI",
    "High"  : "HI",
    "HiMix" : "HI Mix",
    "HiPit" : "HI-PIT",
    "LchFB" : "REP L",
    "LchLv" : "VOL L",
    "Level" : "VOL",
    "LEVEL" : "VOL",
    "LFO"   : "Wave",
    "LoDMP" : "LO-DMP",
    "LoMix" : "LO Mix",
    "LoPit" : "LO-PIT",
    "LOW"   : "LO",
    "Low"   : "LO",
    "Mix"   : "BAL",
    "MIXER" : "Mix",
    "MNL"   : "Pre DLY",
    "Mod"   : "Depth",
    "Mode"  : "Output",
    "OUT_L" : "OUT LVL",
    "PDLY"  : "Pre DLY",
    "PDlyA" : "Pre DLY A",
    "PDlyB" : "Pre DLY B",
    "PreD"  : "Pre DLY",
    "Q1"    : "Q",
    "Rate"  : "Cycle",
    "RateA" : "Rate A",
    "RateB" : "Rate B",
    "RchFB" : "REP R",
    "RchLv" : "VOL R",
    "RecLv" : "Gain",
    "Ref"   : "Reflect",
    "RES"   : "RESO",
    "ResoA" : "RESO A",
    "ResoB" : "RESO B",
    "Shape" : "Wave",
    "SMPL"  : "Sample",
    "Speed" : "Rate",
    "THRSH" : "THRSHLD",
    "TimeA" : "Time A",
    "TimeB" : "Time B",
    "TimeL" : "Time L",
    "TimeR" : "Time R",
    "Tone"  : "Treble",
    "ToneA" : "Tone A",
    "ToneB" : "Tone B",
    "Trebl" : "Treble",
    "WaveA" : "Wave A",
    "WaveB" : "Wave B",
  };

  // Parameter name mappings specific for a particular input effect
  private effectParameterNameMapObj = {
    "ANA234Cho"  : { "LEVEL" : "Mix" },
    "Ba Octave"  : { "Tone"  : "HI" },
    "Bomber"     : { "THRSH" : "TRGGR" },
    "CE-Cho5"    : { "MODE"  : "OUTPUT"},
    "CentaGold"  : { "OUT"   : "VOL" },
    "DualComp"   : { "Hi"    : "HiComp", "Lo"    : "LoComp" },
    "Echo"       : { "TIME"  : "Pre DLY" },
    "GateRev"    : { "Level" : "BAL",   "Dry"    : "BAL" },
    "GrayComp"   : { "OUT"   : "VOL" },
    "HD Reverb"  : { "HPF"   : "LoDMP", "Tone"  : "HiDMP" },
    "HolyFLERB"  : { "RVRB"  : "Mix" },
    "MangledSp"  : { "Low"   : "LO" },
    "OptComp"    : { "Tone"  : "Hi" },
    "SlowFLTR"   : { "Chara" : "Type"},
    "StompDly"   : { "Sync"  : "Time" },
    "TapeEcho3"  : { "SYNC"  : "Time" },
    "TrgHldDly"  : { "THRSH" : "Sense" },

    "Ba Pitch"   : { "Bal"   : "Wet",   "Level" : "Dry" }, // These three have custom handling in code, see below
    "MonoPitch"  : { "Bal"   : "Wet",   "Level" : "Dry" },
    "PitchSHFT"  : { "Bal"   : "Wet",   "Level" : "Dry" },
  }

  // Maps from values in input effect parameter to values in output effect parameter
  private valueStringMapObj = {
    "-Oct"  : "-OCT",
    "-M7"   : "-11",
    "-m7"   : "-10",
    "-M6"   : "-9",
    "-m6"   : "-8",
    "-P5"   : "-7",
    "-Tri"  : "-6",
    "-P4"   : "-5",
    "-M3"   : "-4",
    "-m3"   : "-3",
    "-M2"   : "-2",
    "-m2"   : "-1",
    "-50c"  : "-0.5",
    "-25c"  : "-0.25",
    "Uni"   : "0",
    "+25c"  : "0.25",
    "+50c"  : "0.5",
    "+m2"   : "1",
    "+M2"   : "2",
    "+m3"   : "3",
    "+M3"   : "4",
    "+P4"   : "5",
    "+Tri"  : "6",
    "+P5"   : "7",
    "+m6"   : "8",
    "+M6"   : "9",
    "+m7"   : "10",
    "+M7"   : "11",
    "+Oct"  : "OCT",
    "Oc+5"  : "OCT+5",
    "2Oct"  : "2 OCT",
    "HZD"   : "HAZARD",
    "Close" : "Down",
    "CRTCL" : "CRITICAL",
    "D-P"   : "DLY-PAN",
    "DRIV"  : "DRIVE",
    "M-0"   : "MN-0",
    "M-1"   : "MN-1",
    "M-2"   : "MN-2",
    "M-3"   : "MN-3",
    "M-4"   : "MN-4",
    "M-5"   : "MN-5",
    "M-6"   : "MN-6",
    "M-7"   : "MN-7",
    "M-8"   : "MN-8",
    "M-9"   : "MN-9",
    "M-10"  : "MN-10",
    "M-11"  : "MN-11",
    "M-12"  : "MN-12",
    "M-13"  : "MN-13",
    "M-14"  : "MN-14",
    "M-15"  : "MN-15",
    "M-16"  : "MN-16",    
    "M-17"  : "MN-17",    
    "M-18"  : "MN-18",    
    "M-19"  : "MN-19",    
    "M-20"  : "MN-20",    
    "M-21"  : "MN-21",    
    "M-22"  : "MN-22",
    "M-23"  : "MN-23",
    "M-24"  : "MN-24",
    "M-25"  : "MN-25",
    "M-26"  : "MN-26",
    "M-27"  : "MN-27",
    "M-28"  : "MN-28",
    "M-29"  : "MN-29",
    "M-30"  : "MN-30",
    "M-31"  : "MN-31",
    "M-32"  : "MN-32",
    "M-33"  : "MN-33",
    "M-34"  : "MN-34",
    "M-35"  : "MN-35",
    "M-36"  : "MN-36",
    "M-37"  : "MN-37",
    "M-38"  : "MN-38",
    "M-39"  : "MN-39",
    "M-40"  : "MN-40",
    "M-41"  : "MN-41",
    "M-42"  : "MN-42",
    "M-43"  : "MN-43",
    "M-44"  : "MN-44",
    "M-45"  : "MN-45",
    "M-46"  : "MN-46",
    "M-47"  : "MN-47",
    "M-48"  : "MN-48",
    "M-49"  : "MN-49",
    "M-50"  : "MN-50",
    "Open"  : "Up",
    "P-D"   : "PAN-DLY",
    "Para"  : "Parallel",
    "Seri"  : "Serial",
    "Sine"  : "SINE",
    "STBL"  : "STABLE",
    "STR"   : "Stereo",
    "SawDn" : "SAWDOWN",
    "SawUp" : "SAWUP",
    "S-0"   : "ST-0",
    "S-1"   : "ST-1",
    "S-2"   : "ST-2",
    "S-3"   : "ST-3",
    "S-4"   : "ST-4",
    "S-5"   : "ST-5",
    "S-6"   : "ST-6",
    "S-7"   : "ST-7",
    "S-8"   : "ST-8",
    "S-9"   : "ST-9",
    "S-10"  : "ST-10",
    "S-11"  : "ST-11",
    "S-12"  : "ST-12",
    "S-13"  : "ST-13",
    "S-14"  : "ST-14",
    "S-15"  : "ST-15",
    "S-16"  : "ST-16",    
    "S-17"  : "ST-17",
    "S-18"  : "ST-18",   
    "S-19"  : "ST-19",
    "S-20"  : "ST-20",
    "S-21"  : "ST-21",
    "S-22"  : "ST-22",
    "S-23"  : "ST-23",
    "S-24"  : "ST-24",
    "S-25"  : "ST-25",
    "S-26"  : "ST-26",    
    "S-27"  : "ST-27",
    "S-28"  : "ST-28",   
    "S-29"  : "ST-29",
    "S-30"  : "ST-30",
    "S-31"  : "ST-31",    
    "S-32"  : "ST-32",   
    "S-33"  : "ST-33",
    "S-34"  : "ST-34",    
    "S-35"  : "ST-35",   
    "S-36"  : "ST-36",    
    "S-37"  : "ST-37",   
    "S-38"  : "ST-38",    
    "S-39"  : "ST-39",   
    "S-40"  : "ST-40",    
    "S-41"  : "ST-41",
    "S-42"  : "ST-42",   
    "S-43"  : "ST-43",    
    "S-44"  : "ST-44",   
    "S-45"  : "ST-45",    
    "S-46"  : "ST-46",   
    "S-47"  : "ST-47",    
    "S-48"  : "ST-48",
    "S-49"  : "ST-49",    
    "S-50"  : "ST-50",
    "Tri"   : "TRI",
    "&#119135; x2"  : "&#119135;x2",
    "&#119135; x3"  : "&#119135;x3",
    "&#119135; x4"  : "&#119135;x4",
    "&#119135; x5"  : "&#119135;x5",
    "&#119135; x6"  : "&#119135;x6",
    "&#119135; x7"  : "&#119135;x7",
    "&#119135; x8"  : "&#119135;x8",
    "&#119135; x9"  : "&#119135;x9",
    "&#119135; x10" : "&#119135;x10",
    "&#119135; x11" : "&#119135;x11",
    "&#119135; x12" : "&#119135;x12",
    "&#119135; x13" : "&#119135;x13",
    "&#119135; x14" : "&#119135;x14",
    "&#119135; x15" : "&#119135;x15",
    "&#119135; x16" : "&#119135;x16",
    "&#119135; x17" : "&#119135;x17",
    "&#119135; x18" : "&#119135;x18",
    "&#119135; x19" : "&#119135;x19",
    "&#119135; x20" : "&#119135;x20",
  };

    // Maps from values in input effect parameter to values in output effect parameter, for a specific input effect
  private effectValueStringMapObj = {
    "CE-Cho5"   : { "STR"   : "STEREO" },
    "SuperCho"  : { "STR"   : "STEREO" },
    "Echo"      : { "RAMP"  : "SawUp", "SAW" : "SawDn" },
    "TremDelay" : { "SIN"   : "Sine",  "RAMP" : "SawUp", "SAW" : "SawDn" },
  }

  // Skip value interpolation for these output parameters
  private skipInterpolation = new Set<string>([
    "Duty",
    "Rise",
    "Swell",
    "Time",
    "TimeA",
    "TimeB",
    "Time A",
    "Time B",
    "Time L",
    "Time R",
    "Pre DLY",
    "Pre DLY A",
    "Pre DLY B",
  ]);

  private parameterNameConverterMap: Map<string, string>;
  private effectParameterNameConverterMap: Map<string, Map<string, string>>; 
  private valueStringConverterMap: Map<string, string>;
  private effectValueStringConverterMap: Map<string, Map<string, string>>;

  constructor()
  {
    this.patchConverterMap = zoomPatchConverterMap;

    this.parameterNameConverterMap = new Map<string, string>(Object.entries(this.parameterMapObj));
    this.effectParameterNameConverterMap = new Map<string, Map<string, string>>(Object.entries(this.effectParameterNameMapObj).map(([effectName, parameterMapObj]) => {
        let parameterMap: Map<string, string> = new Map<string, string>(Object.entries(parameterMapObj));
        return [effectName, parameterMap];
      }));
    this.valueStringConverterMap = new Map<string, string>(Object.entries(this.valueStringMapObj));

    this.effectValueStringConverterMap = new Map<string, Map<string, string>>(Object.entries(this.effectValueStringMapObj).map(([effectName, valueMapObj]) => {
      let valueMap: Map<string, string> = new Map<string, string>(Object.entries(valueMapObj));
      return [effectName, valueMap];
    }));
  }

  public canMapEffect(inputEffectID: number): boolean
  {
    return this.patchConverterMap.has(inputEffectID);
  }

  public getMappedEffect(inputEffectID: number): [outputEffectID: number, outputEffectName: string]
  {
    let map = this.patchConverterMap.get(inputEffectID);
    if (map === undefined)
      return [0, ""];
    return [map.msplusID, map.msplusName]
  }

  public canMapParameter(inputEffectID: number, parameterName: string): [canMap: boolean, alternatives: string]
  {
    let map = this.patchConverterMap.get(inputEffectID);
    if (map === undefined)
      return [false, ""];

    let outputEffectID = map.msplusID;

    let effectIDMapPlus = ZoomDevice.getEffectIDMapForDevice("MS-70CDR+");
    if (effectIDMapPlus === undefined) {
      shouldLog(LogLevel.Error) && console.error(`No effect ID map found for device MS-70CDR+`);
      return [false, ""];
    }

    let effectIDMapOG = ZoomDevice.getEffectIDMapForDevice("MS-70CDR");
    if (effectIDMapOG === undefined) {
      shouldLog(LogLevel.Error) && console.error(`No effect ID map found for device MS-70CDR`);
      return [false, ""];
    }

    let inputEffectMap = effectIDMapOG.get(inputEffectID);
    if (inputEffectMap === undefined) {
      shouldLog(LogLevel.Error) && console.error(`No mapping found for MSOG effect ID ${inputEffectID}`);
      return [false, ""];
    }

    let outputEffectMap = effectIDMapPlus.get(outputEffectID);
    if (outputEffectMap === undefined) {
      shouldLog(LogLevel.Error) && console.error(`No mapping found for MS+ effect ID ${outputEffectID}`);
      return [false, ""];
    }

    let parameterIndex = inputEffectMap.parameters.findIndex(parameterMap => parameterMap.name.toLowerCase() === parameterName.toLowerCase());

    if (parameterIndex === -1) {
      shouldLog(LogLevel.Error) && console.error(`No mapping found for parameter "${parameterName}" on input effect ID ${inputEffectID}`);
      return [false, ""];
    }

    let inParamMap = inputEffectMap.parameters[parameterIndex];

    let outputParameterIndex = -1;

    // Look for parameter name mappings for specific effects first
    let effectParameterNameMap = this.effectParameterNameConverterMap.get(inputEffectMap.name);
    if (effectParameterNameMap !== undefined) {
      let outputEffectParamName = effectParameterNameMap.get(inParamMap.name);
      if (outputEffectParamName !== undefined) {
        outputParameterIndex = outputEffectMap.parameters.findIndex(parameterMap => parameterMap.name === outputEffectParamName); 
      }
    }

    // Look for parameter name mappings in the parameterNameConverterMap
    if (outputParameterIndex === -1) {
      outputParameterIndex = outputEffectMap.parameters.findIndex(parameterMap => 
        parameterMap.name.toLowerCase() === this.parameterNameConverterMap.get(inParamMap.name)?.toLowerCase());
    }

    // Look for parameter name mappings in the value map
    if (outputParameterIndex === -1) {
      outputParameterIndex = outputEffectMap.parameters.findIndex(parameterMap =>
        parameterMap.name.toLowerCase() === inParamMap.name.toLowerCase());
    }
    
    let alternatives = "";
    if (outputParameterIndex === -1) {
      for (let i=0; i<outputEffectMap.parameters.length; i++) {
        let parameterMap = outputEffectMap.parameters[i];
        alternatives += ` "${parameterMap.name}"`;
      }
    }

    if (outputParameterIndex !== -1) {
      let outParamMap = outputEffectMap.parameters[outputParameterIndex];
      for (let inParamVal = 0; inParamVal < inParamMap.values.length; inParamVal++) {
        if (inParamMap.maxNumerical === undefined || inParamVal > inParamMap.maxNumerical) {
          // The input value is a text-value, not a numerical value
          let inParamValString = inParamMap.values[inParamVal]; 
          let index = this.findIndexOfInputParameterValueStringInOutputParameterMap(inputEffectMap.name, inParamValString, outParamMap);

          if (index !== -1) {
            let outParamValString = outParamMap.values[index];
            let [value, max] = ZoomDevice.getRawParameterValueFromStringAndMap(effectIDMapPlus, outputEffectID, outputParameterIndex + 2, outParamValString);
            if (max !== -1) {
              // Mapping succeeded
            }
            else {
              alternatives += `Raw value failed for "${outParamValString}. "`;
            }
          }
          else {
            alternatives += `Missing value string "${inParamValString}". `;
          }
        }        
      }
    }

    return [outputParameterIndex !== -1, alternatives];
  }

  public convert(inputPatch: ZoomPatch): [zoomPatch: ZoomPatch | undefined, unmappedSlotParameterList: [slot: number, parameterNumber: number, unmapped: boolean][]]
  {
    let unmappedSlotParameterList: [slot: number, parameterNumber: number, unmapped: boolean][] = [];
    if (inputPatch.MSOG === null) {
      shouldLog(LogLevel.Error) && console.error(`Patch conversion only possible for patches from the original MS pedals`);
      return [undefined, unmappedSlotParameterList];
    }

    let effectIDMapPlus = ZoomDevice.getEffectIDMapForDevice("MS-70CDR+");
    if (effectIDMapPlus === undefined) {
      shouldLog(LogLevel.Error) && console.error(`No effect ID map found for device MS-70CDR+`);
      return [undefined, unmappedSlotParameterList];
    }

    let effectIDMapOG = ZoomDevice.getEffectIDMapForDevice("MS-70CDR");
    if (effectIDMapOG === undefined) {
      shouldLog(LogLevel.Error) && console.error(`No effect ID map found for device MS-70CDR`);
      return [undefined, unmappedSlotParameterList];
    }

    let outputPatch: ZoomPatch = ZoomPatch.createEmptyPTCFPatch(ZoomPatch.NAME_LENGTH_MS_PLUS);

    outputPatch.name = inputPatch.name;
    outputPatch.descriptionEnglish = `Converted from MS-70CDR patch "${inputPatch.name}" using https://sym.bios.is by Waveformer`;
    outputPatch.tempo = inputPatch.tempo;
    outputPatch.currentEffectSlot = inputPatch.currentEffectSlot;

    outputPatch.updatePatchPropertiesFromDerivedProperties();

    if (outputPatch.effectSettings === null || outputPatch.ids === null || outputPatch.edtbReversedBytes === null) {
      shouldLog(LogLevel.Error) && console.error(`outputPatch.effectSettings === null || outputPatch.ids === null || outputPatch.edtbReversedBytes === null. This should never happen.`);
      return [undefined, unmappedSlotParameterList];
    }

    // Convert parameters

    if (inputPatch.numEffects === null || inputPatch.numEffects === 0 || inputPatch.effectSettings === null || inputPatch.effectSettings.length === 0) {
       // A patch should always have at least one effect. If the patch is empty, the effect ID in the first slot should be 0.
      shouldLog(LogLevel.Warning) && console.warn(`Input patch "${inputPatch.name}" has numEffects === null or 0, or effectSettings === null or has length 0. A patch should always have at least 1 effect.`)
    }
    else {
      outputPatch.numEffects = inputPatch.numEffects;
  
      outputPatch.ids = new Uint32Array(outputPatch.idBuffer, 0, outputPatch.numEffects);
  
      for (let slotNumber = 0; slotNumber < inputPatch.numEffects; slotNumber++) {
        let inputEffect = inputPatch.effectSettings[slotNumber];
        let outputEffect = new EffectSettings();

        // Look up inputEffect.id and find a matching output ID
        let map = this.patchConverterMap.get(inputEffect.id);

        if (map === undefined) {
          shouldLog(LogLevel.Info) && console.log(`No conversion mapping found for effect ID ${inputEffect.id} in slot ${slotNumber} patch "${inputPatch.name}". Inserting empty effect.`);
          outputEffect.id = 0x00000000;
          outputEffect.enabled = false;
        }
        else {
          let inputEffectMap = effectIDMapOG.get(inputEffect.id);
          if (inputEffectMap === undefined) {
            shouldLog(LogLevel.Warning) && console.warn(`No mapping found for MSOG effect ID ${inputEffect.id} in slot ${slotNumber} patch "${inputPatch.name}"`);
            continue;
          }

          outputEffect.id = map.msplusID;

          // Some input effects map to different output effects depending on parameters
          if (inputEffectMap.name === "Delay") {
            let inputParameterIndex = inputEffectMap.parameters.findIndex(parameterMap => parameterMap.name === "P-P");
            let value = inputEffect.parameters[inputParameterIndex];
            if (value === 1) { // "P-P"
              // The MS+ "Delay" effect doesn't support ping-pong mode, only mono mode
              // So we use the "P-P Delay" effect instead
              outputEffect.id = 0x08000080; // "P-P Delay"
            }
          }

          outputEffect.enabled = inputEffect.enabled;
          
          let outputEffectMap = effectIDMapPlus.get(outputEffect.id);
          if (outputEffectMap === undefined) {
            shouldLog(LogLevel.Warning) && console.warn(`No mapping found for MS+ effect ID ${outputEffect.id} in slot ${slotNumber} patch "${inputPatch.name}"`);
            continue;
          }

          let timeVal: number | undefined = undefined; // for setting Mode parameter

          let pitchShiftZero: boolean = false; // for PolyPitch mapping of Shift 0
          let pitchShiftBal: number = -1; // for PolyPitch mapping of Bal and Level
          let pitchShiftWetParameterIndex = -1; // for PolyPitch.Wet

          let gateRevLevel: number = -1;
          
          shouldLog(LogLevel.Info) && console.log(`Mapping patch "${inputPatch.name}" slot ${slotNumber} effect ID ${inputEffect.id} "${inputEffectMap.name}" `+
            `-> effect ID ${outputEffect.id} "${outputEffectMap.name}"`);

          ZoomDevice.setDefaultsForEffect(outputEffect, effectIDMapPlus);

          // Loop through parameters and map
          for (let parameterIndex = 0; parameterIndex < inputEffectMap.parameters.length; parameterIndex++) {
            let inParamVal = inputEffect.parameters[parameterIndex];
            let inParamMap = inputEffectMap.parameters[parameterIndex];

            let outputParameterIndex: number = -1;
            let reverseRange = false;
            let inParamValBreakpoint: number | undefined = undefined;
            let outParamValBreakpoint: number | undefined = undefined;
            let useBreakpointInterpolation = false;

            if (inParamMap.name === "Level") {
              //
              useBreakpointInterpolation = true;
              inParamValBreakpoint = 100; // 100 seems to e the most commonly used default for MSOG Level
              outParamValBreakpoint = 80; // 80 seems to be the most commonly used default for MS+ VOL
            }
            else if (inputEffectMap.name === "GateRev" && inParamMap.name === "Decay") {
              useBreakpointInterpolation = true;
              inParamValBreakpoint = 50;
              outParamValBreakpoint = 65;
            }
            else if (inputEffectMap.name === "HD Reverb" && inParamMap.name === "Mix") {
              // Based on preset DeltaVegaArW
              useBreakpointInterpolation = true;
              inParamValBreakpoint = 26;
              outParamValBreakpoint = 50;
            }
            else if (inputEffectMap.name === "ParticleR" && inParamMap.name === "DWELL") {
              useBreakpointInterpolation = true; // use the default values in outputEffectMap for the "Decay" parameter as breakpoints
            }
            else if (inputEffectMap.name === "ParticleR" && inParamMap.name === "MIX") {
              // Based on preset ArcturuPdW
              useBreakpointInterpolation = true;
              inParamValBreakpoint = 73;
              outParamValBreakpoint = 94;
            }
            else if (inputEffectMap.name === "OptComp" && inParamMap.name === "Level") {
              useBreakpointInterpolation = true; // use the default values in outputEffectMap for the "VOL" parameter as breakpoints
            }
            
            if (inputEffectMap.name === "HD Reverb" && inParamMap.name === "HPF") {
              reverseRange = true;
            }

            // Look for parameter name mappings for specific effects first
            let effectParameterNameMap = this.effectParameterNameConverterMap.get(inputEffectMap.name);
            if (effectParameterNameMap !== undefined) {
              let outputEffectParamName = effectParameterNameMap.get(inParamMap.name);
              if (outputEffectParamName !== undefined) {
                outputParameterIndex = outputEffectMap.parameters.findIndex(parameterMap => parameterMap.name === outputEffectParamName); 
              }
            }

            // Look for parameter name mappings in the parameterNameConverterMap
            if (outputParameterIndex === -1) {
              outputParameterIndex = outputEffectMap.parameters.findIndex(parameterMap => 
                parameterMap.name.toLowerCase() === this.parameterNameConverterMap.get(inParamMap.name)?.toLowerCase());
            }

            // Look for parameter name mappings in the value map
            if (outputParameterIndex === -1) {
              outputParameterIndex = outputEffectMap.parameters.findIndex(parameterMap =>
                parameterMap.name.toLowerCase() === inParamMap.name.toLowerCase());
            }

            if (outputParameterIndex === -1) {
              let alternatives = "";
              outputEffectMap.parameters.forEach(parameterMap => {
                  alternatives += ` ${parameterMap.name}`;
              })
              let parameterNumber = parameterIndex + 2;
              unmappedSlotParameterList.push([slotNumber, parameterNumber, true]);
              shouldLog(LogLevel.Info) && console.log(`  Parameter ${parameterIndex} ${inParamMap.name.padStart(8)} = ` +
                `${inParamVal.toString(10).padStart(4, " ")} -> No matching output parameter found. Alternatives:${alternatives}.`);
              continue;
            }

            let outParamMap = outputEffectMap.parameters[outputParameterIndex];
            
            let outParamVal: number | undefined = undefined;
            let explanation = "";
            
            // if (this.skipInterpolation.has(outParamMap.name) && outParamMap.maxNumerical !== undefined && 
            //   inParamMap.maxNumerical !== undefined && inParamVal <= inParamMap.maxNumerical)
            // { // If the input parameter is time, we should not interpolate, we should use the time value directly (since the value is in milliseconds)
            //   outParamVal = Math.min(inParamVal, outParamMap.maxNumerical);
            //   useLinearInterpolaton = false;
            //   if (inParamVal > outParamMap.maxNumerical) {
            //     explanation = `Input value ${inParamVal} is greater than output parameter max value ${outParamMap.maxNumerical}`;
            //   }

            //       // Use binary search to find the correct non-linear value
            //       let lowerBoundIndex = outParamMap.maxLinearNumerical;
            //       let upperBoundIndex = outParamMap.maxNumerical;
            //       outParamVal = this.binarySearch(screenVal, outParamMap.valuesNumerical, lowerBoundIndex, upperBoundIndex);
            //       explanation = `Non-linear values detected. Screen value (${screenVal}) is in non-linear range. Binary search to screen value ${outParamMap.valuesNumerical[outParamVal]}.`;


            // }
            // else

            //     "Bomber"     : { "THRSH" : "TRGGR" },


            if (inputEffectMap.name === "Bomber" && inParamMap.name === "THRSH") {
              outParamVal = 0; // Always be triggered by the input
            }
            else if (inputEffectMap.name === "DualDigiD" || inParamMap.name === "TimeA" || inParamMap.name === "TimeB") {
              if (inParamVal > inParamMap.max - 2)
                outParamVal = outParamMap.max; // quarter note x7 and x8 isn't supported on the MS+
            }
            else if (inputEffectMap.name === "GateRev") {
              if (inParamMap.name === "Level") {
                gateRevLevel = inParamVal;
              }
              else if (inParamMap.name === "Dry") {
                let colorParameterIndex = outputEffectMap.parameters.findIndex(parameterMap => parameterMap.name === "Color");
                outputEffect.parameters[colorParameterIndex] = 1; // Color = 2 (index 1) seems to be closest to the MSOG GateRev algorithm
                let dry = inParamVal === 1
                if (!dry)
                  outParamVal = 100; // no dry -> BAL = 100% wet
                else
                  outParamVal = Math.round(gateRevLevel / 100 * 75); // dry -> BAL maxes out at 75% wet (sounds about right to my ears)
              }
            }
            else if (inputEffectMap.name === "StompDly" || inputEffectMap.name === "TapeEcho3") {
              if (inParamMap.name.toLowerCase() === "sync") {
                if (inParamVal === 0) {
                  continue; // ignore SYNC OFF (Time output variable already set based on TIME input variable)
                }
                else {
                  let inParamValString = inParamMap.values[inParamVal];
                  let index = outParamMap.values.findIndex(value => value.trim().toLowerCase() === inParamValString.trim().toLowerCase())
                  if (index === -1 && this.valueStringConverterMap.has(inParamValString))
                    shouldLog(LogLevel.Error) && console.log(`${inputEffectMap.name} ${inParamMap.name} parameter mismatch. Input value: ${inParamValString} not found in outParamMap. Investigate.`)
                  else {
                    let outParamValString = outParamMap.values[index];
                    let [value, max] = ZoomDevice.getRawParameterValueFromStringAndMap(effectIDMapPlus, outputEffect.id, outputParameterIndex + 2, outParamValString);
                    if (max === -1)
                      shouldLog(LogLevel.Error) && console.log(`${inputEffectMap.name} ${inParamMap.name} parameter mismatch. No raw parameter value for inParamValString: ${inParamValString}, ` +
                        `outParamValString: ${outParamValString}. Investigate.`)
                    else
                      outParamVal = value;
                  }
                }
              }
            }
            else if (inputEffectMap.name === "Ba Pitch" || inputEffectMap.name === "MonoPitch" || inputEffectMap.name === "PitchSHFT") {
              if (inParamMap.name === "Shift") {
                if (inParamVal <= 11) // -12 .. -1
                  outParamVal = inParamVal + 1; // PolyShift has -24 as first value, while the MSOG effects has -12 as first value
                else if (inParamVal == 12) { // The MSOG effects support pitch shift 0, but the PolyShift effect doesnt
                  outParamVal = inParamVal + 1; // PolyShift has -24 as first value, while the MSOG effects has -12 as first value
                  pitchShiftZero = true; // set Wet to 0 and Dry to Level
                }
                else
                  outParamVal = inParamVal;
              }
              else if (inParamMap.name === "Bal") {
                pitchShiftBal = inParamVal;
                pitchShiftWetParameterIndex = outputParameterIndex;
                // Bal maps to Wet, but value is overwritten below
              }
              else if (inParamMap.name === "Level") {
                // Level maps to Dry, but (output) Wet and Dry are both set based on (input) Bal and Level 

                // Based on measurements of audio level in Ableton Live, comparing PitchSHFT and PolyShift: 
                //   o when input level is 150 and balance is 0 or 100, max dry or wet should be 95 
                //   o when input level is 150 and balance is 50, max dry or wet should be 84
                // So we scale linearly between these, based on balance 
                // This could be refined with one or two more breakpoints to work better inbetween 50:50 and all wet or dry.
                // Could also boost output levels a bit for the Ba Pitch effect, which is louder than the two others (more base).
                // But I'm not sure it's worth the effort tweaking this any more - the MSOG and MS+ effects are quite different.

                let wet: number;
                let dry: number;

                let level = inParamVal / 150;

                let inputBreakpoint = 50;
                let outputBreakpoint = 84;
                let outputMax = 95;

                if (pitchShiftZero)
                  pitchShiftBal = 0;

                let inversePitchShiftBal = 100 - pitchShiftBal;

                wet = pitchShiftBal <= inputBreakpoint ? pitchShiftBal/inputBreakpoint * outputBreakpoint : 
                  (pitchShiftBal - inputBreakpoint) / (100 - inputBreakpoint) * (outputMax - outputBreakpoint) + outputBreakpoint; 

                dry = inversePitchShiftBal <= inputBreakpoint ? inversePitchShiftBal/inputBreakpoint * outputBreakpoint : 
                  (inversePitchShiftBal - inputBreakpoint) / (100 - inputBreakpoint) * (outputMax - outputBreakpoint) + outputBreakpoint; 

                wet *= level;
                dry *= level;

                outputEffect.parameters[pitchShiftWetParameterIndex] = Math.max(0, Math.min(100, Math.round(wet)));
                outParamVal = Math.max(0, Math.min(100, Math.round(dry)));
              }
            }
            
            if (outParamVal === undefined && (inParamMap.maxNumerical === undefined || inParamVal > inParamMap.maxNumerical)) {
              // The input value is a text-value, not a numerical value
              let inParamValString = inParamMap.values[inParamVal];

              // let index = outParamMap.values.findIndex(value => value.trim().toLowerCase() === inParamValString.trim().toLowerCase())
              // if (index === -1 && this.valueStringConverterMap.has(inParamValString))
              //   index = outParamMap.values.findIndex(value => value.trim().toLowerCase() === this.valueStringConverterMap.get(inParamValString)!.trim().toLowerCase())

              let index = this.findIndexOfInputParameterValueStringInOutputParameterMap(inputEffectMap.name, inParamValString, outParamMap);

              if (index !== -1) {
                let outParamValString = outParamMap.values[index];
                let [value, max] = ZoomDevice.getRawParameterValueFromStringAndMap(effectIDMapPlus, outputEffect.id, outputParameterIndex + 2, outParamValString);
                if (max !== -1) {
                  outParamVal = value;
                }
                else {
                  explanation = `Unable to calculate numerical value for output value string "${outParamValString}"`
                }
              }
              else {
                explanation = `Input value string "${inParamValString}" not found in output values list`
              }
            }

            if (outParamVal === undefined && outParamMap.maxNumerical === undefined && inParamMap.maxNumerical !== undefined && inParamMap.max === outParamMap.max)
            { // The input parameter is numerical, but the output parameter is not. It's the same number of values, so we use the 0-based "index" values
              // This covers the case for A-Pan DLY where the input Rate is numerical but the output Cycle is not
              outParamVal = inParamVal;
              explanation = `Numerical input and non-numerical outout parameter detected. Same value array length. Setting outParamVal to inParamVal.`;
            }

            if (outParamVal === undefined) 
            { // Straight up linear interpolation with an optional breakpoint at (inputEffectMap.default, outputEffectMap.default)

              if (outParamMap.maxLinearNumerical === undefined || outParamMap.maxNumerical === undefined || outParamMap.valuesNumerical === undefined ||
                inParamMap.maxLinearNumerical === undefined || inParamMap.maxNumerical === undefined || inParamMap.valuesNumerical === undefined)
              {
                shouldLog(LogLevel.Error) && console.error(`One of the numerical properties were undefined in input or output map ` +
                  `for input effect ${inputEffectMap.name} parameter ${inParamMap.name}, even though the input value isn't text, so it should be numerical. Investigate.`);
                continue;
              }

              if (outParamMap.maxLinearNumerical < outParamMap.maxNumerical)
              {
                // Handle parameters where the parameter values might not be linear through the value
                let inParamScreenVal = inParamMap.valuesNumerical[inParamVal];
                let inParamMaxVal = inParamMap.valuesNumerical[inParamMap.maxNumerical];
                let inParamMinVal = inParamMap.valuesNumerical[0];
                let outParamMaxVal= outParamMap.valuesNumerical[outParamMap.maxNumerical];
                let outParamMinVal = outParamMap.valuesNumerical[0];

                let screenVal: number;

                if (this.skipInterpolation.has(outParamMap.name) && inParamVal <= inParamMap.maxNumerical) {
                  // No interpolation
                  screenVal = Math.min(inParamScreenVal, outParamMaxVal);
                }
                else {
                  // Interpolaton
                  screenVal = inParamMinVal + Math.round((inParamScreenVal- inParamMinVal) / inParamMaxVal * outParamMaxVal);
                }

                let outParamMaxLinearVal = outParamMap.valuesNumerical[outParamMap.maxLinearNumerical];
                if (screenVal <= outParamMaxLinearVal && inParamMinVal === outParamMinVal) {
                  // We're in the linear range, so we can use the 0-based "index" values
                  outParamVal = inParamVal;
                  explanation = `Non-linear parameter detected. Screen value (${screenVal}) is in linear range [${inParamMinVal}, ${outParamMaxLinearVal}], setting outParamVal to inParamVal.`;
                  if (inParamMap.valuesNumerical.length > 1 && outParamMap.valuesNumerical.length > 1 && 
                    inParamMap.valuesNumerical[1] - inParamMap.valuesNumerical[0] !== outParamMap.valuesNumerical[1] - outParamMap.valuesNumerical[0])
                  { 
                    shouldLog(LogLevel.Error) && console.error(`Screen value (${screenVal}) is in linear range [${inParamMinVal}, ${outParamMaxLinearVal}], but input and output values are not increasing at the same rate. Investigate.`); 
                  }
                }
                else {
                  // Use binary search to find the correct non-linear value
                  let lowerBoundIndex = outParamMap.maxLinearNumerical;
                  let upperBoundIndex = outParamMap.maxNumerical;
                  outParamVal = this.binarySearch(screenVal, outParamMap.valuesNumerical, lowerBoundIndex, upperBoundIndex);
                  explanation = `Non-linear values detected. Screen value (${screenVal}) is in non-linear range. Binary search to screen value ${outParamMap.valuesNumerical[outParamVal]}.`;
                }

                if (screenVal != inParamScreenVal) {
                  let parameterNumber = parameterIndex + 2;
                  unmappedSlotParameterList.push([slotNumber, parameterNumber, false]); //  input and output values differ
                }
              }
              else {
                // Values are linear, so we can interpolate the value "index" (0-based) instead of the actual value shown on screen/pedal
  
                if (outParamMap.maxLinearNumerical !== outParamMap.maxNumerical || inParamMap.maxLinearNumerical !== inParamMap.maxNumerical)
                {
                  shouldLog(LogLevel.Error) && console.error(`Mismatch between maxNumerical and maxLinearNumerical ` +
                    `for input effect ${inputEffectMap.name} parameter ${inParamMap.name}. Investigate.`);
                  continue;
                }  

                if (reverseRange) {
                  inParamVal = inParamMap.max - inParamVal;
                }

                if (useBreakpointInterpolation) {
                  inParamValBreakpoint ??= inParamMap.default;
                  outParamValBreakpoint ??= outParamMap.default;
                }

                if (inParamMap.default === undefined || outParamMap.default === undefined || inParamMap.maxLinearNumerical === inParamMap.default ||
                  outParamMap.maxLinearNumerical === outParamMap.default || !useBreakpointInterpolation)
                { // Interpolate between (0, outParamMap.maxLinearNumerical)
                  outParamVal = Math.round(inParamVal / inParamMap.maxLinearNumerical * outParamMap.maxLinearNumerical);
                }
                else if (inParamVal < inParamValBreakpoint!) // 2025-05-24: was inParamMap.default
                { // Interpolate between (0, outParamValBreakpoint)
                  outParamVal = Math.round(inParamVal / inParamValBreakpoint! * outParamValBreakpoint!);
                }
                else 
                { // Interpolate between (outParamValBreakpoint, outParamMap.maxLinearNumerical)
                  outParamVal = Math.round((inParamVal - inParamValBreakpoint!) / (inParamMap.maxLinearNumerical - inParamValBreakpoint!) * 
                    (outParamMap.maxLinearNumerical - outParamValBreakpoint!) + outParamValBreakpoint!);
                }

                if (inParamMap.valuesNumerical !== undefined && outParamMap.valuesNumerical !== undefined) {
                  let inParamScreenVal = inParamMap.valuesNumerical[inParamVal];
                  let outParamScreenVal = outParamMap.valuesNumerical[outParamVal];
                  
                  if (outParamScreenVal != inParamScreenVal) {
                    let parameterNumber = parameterIndex + 2;
                    unmappedSlotParameterList.push([slotNumber, parameterNumber, false]); //  input and output values differ
                  }
                }
              }
            }

            if (outParamVal === undefined) {
              shouldLog(LogLevel.Error) && console.error(`outParamVal === undefined for param ${parameterIndex} ${inParamMap.name.padStart(8)} (${inParamMap.default}) = `+
                `${inParamVal.toString(10).padStart(4, " ")}. This should never hapen!`);
              continue;
            }

            if (isNaN(outParamVal)) {
              shouldLog(LogLevel.Error) && console.error(`outParamVal is not a number for param ${parameterIndex} ${inParamMap.name.padStart(8)} (${inParamMap.default}) = `+
                `${inParamVal.toString(10).padStart(4, " ")}. This should never hapen!`);
              continue;
            }

            timeVal = outParamMap.name.includes("Time") ? outParamVal : timeVal; // for setting Mode parameter below

            outputEffect.parameters[outputParameterIndex] = outParamVal;

            shouldLog(LogLevel.Info) && console.log(`  Param ${parameterIndex} ${inParamMap.name.padStart(8)} (${inParamMap.default?.toString(10).padStart(4, " ")}) = `+
              `${inParamVal.toString(10).padStart(4, " ")} -> Param ${outputParameterIndex } ${outParamMap.name.padStart(8)} (${outParamMap.default?.toString(10).padStart(4, " ")}) = ` +
              `${outParamVal.toString(10).padStart(4, " ")} ${explanation}`);
          }
          // If we have a Time and a Mode parameter for setting the time mode, we set the Mode parameter here
          let modeParamMap = outputEffectMap.parameters.find( p => p.name === "Mode");
          if (modeParamMap !== undefined && modeParamMap.values.length > 1 && (modeParamMap.values[0] === "TIME" || modeParamMap.values[0] === "SHORT")) {
            let timeParamMap = outputEffectMap.parameters.find( p => p.name.includes("Time"));
            if (timeParamMap !== undefined) {
              if (timeVal === undefined)
                shouldLog(LogLevel.Error) && console.error(`time === undefined for effect ${outputEffectMap.name} parameter ${timeParamMap.name}. `+
                  `This should never hapen!`);              
              else if (timeParamMap.maxLinearNumerical === undefined)
                shouldLog(LogLevel.Error) && console.error(`timeParameter.maxLinearNumerical === undefined for effect ${outputEffectMap.name} parameter ${timeParamMap.name}. `+
                  `This should never hapen!`);  
              else if (timeParamMap.maxNumerical === undefined)
                shouldLog(LogLevel.Error) && console.error(`timeParameter.maxNumerical === undefined for effect ${outputEffectMap.name} parameter ${timeParamMap.name}. `+
                  `This should never hapen!`);  
              else {
                let modeParameterIndex = outputEffectMap.parameters.findIndex(p => p.name === "Mode");
                if (modeParameterIndex === -1)
                  shouldLog(LogLevel.Error) && console.error(`modeParameterIndex === -1 for effect ${outputEffectMap.name} parameter ${timeParamMap.name}. `+
                    `This should never hapen!`);
                if (timeVal < timeParamMap.maxLinearNumerical) {
                  if (modeParamMap.values[0] === "TIME" || modeParamMap.values[0] === "SHORT")
                    outputEffect.parameters[modeParameterIndex] = 0; // "TIME" and "SHORT" are both at index 0, see zoom-effect-mappings-ms70cdrp.json
                  else
                    shouldLog(LogLevel.Warning) && console.warn(`modeParamMap.values[0] !== "TIME" or "SHORT" for effect ${outputEffectMap.name} parameter ${timeParamMap.name}. `+
                      `Investigate!`);
                }
                else if (timeVal >= timeParamMap.maxLinearNumerical && timeVal <= timeParamMap.maxNumerical) {
                  if (modeParamMap.values[0] === "TIME")
                    outputEffect.parameters[modeParameterIndex] = 0; // "TIME" is at index 0, see zoom-effect-mappings-ms70cdrp.json
                  else if (modeParamMap.values[1] === "LONG")
                    outputEffect.parameters[modeParameterIndex] = 1; // "LONG" is at index 1, see zoom-effect-mappings-ms70cdrp.json
                  else
                    shouldLog(LogLevel.Warning) && console.warn(`modeParamMap.values[0] !== "TIME" || modeParamMap.values[1] !== "LONG" for effect ${outputEffectMap.name} parameter ${timeParamMap.name}. `+
                      `Investigate!`);
                }
                else if (timeVal > timeParamMap.maxNumerical && timeVal <= timeParamMap.max) {
                  if (modeParamMap.values[1] === "BPM SYNC")
                    outputEffect.parameters[modeParameterIndex] = 1; // "BPM SYNC" is at index 1, see zoom-effect-mappings-ms70cdrp.json
                  else if (modeParamMap.values.length > 2 && modeParamMap.values[2] === "BPM SYNC")
                    outputEffect.parameters[modeParameterIndex] = 2; // "BPM SYNC" is at index 2, see zoom-effect-mappings-ms70cdrp.json
                  else
                    shouldLog(LogLevel.Warning) && console.warn(`modeParamMap.values[1] !== "BPM SYNC" && modeParamMap.values[2] !== "BPM SYNC"for effect ${outputEffectMap.name} parameter ${timeParamMap.name}. `+
                      `Investigate!`);
                }
                else {
                  shouldLog(LogLevel.Warning) && console.warn(`timeVal >= timeParamMap.max for effect ${outputEffectMap.name} parameter ${timeParamMap.name}. `+
                    `Investigate!`);
                }
              }
            }
          }
        }

        let reversedBytes = new Uint8Array(PTCF_EDTB_REVERSED_BYTES_SIZE);
        reversedBytes.fill(0); // required by ZoomPatch.buildPTCFChunk() but otherwise unused
        if (slotNumber >= outputPatch.edtbReversedBytes.length)
          outputPatch.edtbReversedBytes.push(reversedBytes);
        else
          outputPatch.edtbReversedBytes[slotNumber] = reversedBytes;

        outputPatch.ids[slotNumber] = outputEffect.id;

        if (slotNumber >= outputPatch.effectSettings.length)
          outputPatch.effectSettings.push(outputEffect);
        else
          outputPatch.effectSettings[slotNumber] = outputEffect;
      }
    }

    outputPatch.edtbLength = outputPatch.edtbReversedBytes.length * PTCF_EDTB_REVERSED_BYTES_SIZE;

    // PRM2 chunk

    // FIXME: This should be kept in sync internally in ZoomPatch instead of here
    if (outputPatch.prm2Buffer === null || outputPatch.prm2InvalidEffectSlot === null || outputPatch.prm2PatchVolume === null ||
      outputPatch.prm2EditEffectSlot === null || outputPatch.prm2Tempo === null ||
      outputPatch.prm2Byte2Lower6Bits === null || outputPatch.prm2Byte3Upper4Bits === null ||
      outputPatch.prm2Byte9Lower5Bits === null || outputPatch.prm2Byte10Bit5 === null || outputPatch.edtbEffectSettings === null ||
      outputPatch.prm2Byte13 === null || outputPatch.prm2Byte14 === null ||
      outputPatch.prm2Byte20Bit1And8 === null || outputPatch.prm2Byte21Lower4Bits === null || outputPatch.prm2Byte22Bits3To7 === null ||
      outputPatch.prm2Byte23Upper3Bits === null || outputPatch.prm2Byte24 === null)
    {
      shouldLog(LogLevel.Error) && console.error(`Unable toLowerCase()); build PRM2 patch buffer. Inconsistent patch data for patch ${outputPatch.name}.`);
      return [undefined, unmappedSlotParameterList];
    } 
    else {
      outputPatch.prm2EditEffectSlotBits = ZoomPatch.effectSlotToPrm2BitPattern(outputPatch.prm2EditEffectSlot, outputPatch.edtbEffectSettings.length);
      outputPatch.prm2PreampSlot = ZoomPatch.createPreampSlotBits(outputPatch.edtbEffectSettings);
      outputPatch.prm2BPMSlot = ZoomPatch.createBPMSlotBits(outputPatch.edtbEffectSettings);
      outputPatch.prm2LineSelSlot = ZoomPatch.createLineSelSlotBits(outputPatch.edtbEffectSettings);
      outputPatch.setPrm2BufferFromDerivedValues(outputPatch.prm2Buffer, true, outputPatch.prm2InvalidEffectSlot, outputPatch.prm2PatchVolume, outputPatch.prm2EditEffectSlot,
        outputPatch.edtbEffectSettings.length, outputPatch.prm2PreampSlot, outputPatch.prm2BPMSlot, outputPatch.prm2LineSelSlot, outputPatch.prm2Tempo,
        outputPatch.prm2Byte2Lower6Bits, outputPatch.prm2Byte3Upper4Bits,
        outputPatch.prm2Byte9Lower5Bits, outputPatch.prm2Byte10Bit5,
        outputPatch.prm2Byte13, outputPatch.prm2Byte14,
        outputPatch.prm2Byte20Bit1And8, outputPatch.prm2Byte21Lower4Bits, outputPatch.prm2Byte22Bits3To7,
        outputPatch.prm2Byte23Upper3Bits, outputPatch.prm2Byte24);
      outputPatch.prm2Length = outputPatch.prm2Buffer.length;
    }

    return [outputPatch, unmappedSlotParameterList];
  }

  /**
   * This is a binary search algorithm implementation in TypeScript. It searches for a value (screenVal) within a 
   * sorted array (values) and returns the index of the closest match. If an exact match is found, it returns that index. 
   * If not, it returns the index of the value that is closest to screenVal.
   * 
   * Note that this implementation is slightly modified from the standard binary search algorithm, as it also considers
   * the values adjacent to the midIndex when determining the closest match.
   * 
   * @param searchValue Value to search for
   * @param values Array of values to search in
   * @param lowBoundIndex The lower bound of where in the values array to search
   * @param highBoundIndex The upper bound of where in the values array to search
   * @returns The index of the value that is closest to searchValue
   */
  private binarySearch(searchValue: number, values: Array<number>, lowBoundIndex: number, highBoundIndex: number): number
  {
    let outParamVal = -1;
    let maxIndex = highBoundIndex;
    while (lowBoundIndex <= highBoundIndex) {
      let midIndex = Math.floor((lowBoundIndex + highBoundIndex) / 2);
      let val = values[midIndex];
      let below = midIndex > 0 ? values[midIndex - 1] : val;
      let above = midIndex < maxIndex ? values[midIndex + 1] : val;
      if (val === searchValue) {
        outParamVal = midIndex;
        break;
      }
      else if (searchValue < val && searchValue > below) {
        outParamVal = val - searchValue > searchValue - below && midIndex > 0 ? midIndex - 1 : midIndex;
        break;
      }
      else if (searchValue > val && searchValue < above) {
        outParamVal = searchValue - val > above - searchValue && midIndex < maxIndex ? midIndex + 1 : midIndex;
        break;
      }
      else if (val < searchValue) {
        lowBoundIndex = midIndex + 1;
      }
      else {
        highBoundIndex = midIndex - 1;
      }
    }
    if (outParamVal === -1) {
      shouldLog(LogLevel.Error) && console.error(`Binary search failed for value ${searchValue}. This should never happen`);
      outParamVal = lowBoundIndex;
    }
    return outParamVal;
  }

  private findIndexOfInputParameterValueStringInOutputParameterMap(inputEffectName: string, inParamValString: string, outParamMap: ParameterValueMap) {
    let index = -1;

    // First check if we have a value mapping that is specific for effect + parameter
    let valueStringConverterMap = this.effectValueStringConverterMap.get(inputEffectName);
    if (valueStringConverterMap !== undefined)
      index = outParamMap.values.findIndex(value => value.trim().toLowerCase() === valueStringConverterMap.get(inParamValString)?.trim().toLowerCase());

    // Then check if we have a value mapping that is specific for a parameter
    if (index === -1)
      index = outParamMap.values.findIndex(value => value.trim().toLowerCase() === this.valueStringConverterMap.get(inParamValString)?.trim().toLowerCase());

    // And finally check if we have an output value with the same name
    if (index === -1)
      index = outParamMap.values.findIndex(value => value.trim().toLowerCase() === inParamValString.trim().toLowerCase());
    return index;
  }
}
