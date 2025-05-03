import { LogLevel, shouldLog } from "./Logger.js";
import zoomPatchConverterMap from "./zoom-patch-converter-map.js";
import { ZoomDevice } from "./ZoomDevice.js";
import { EffectSettings, PTCF_EDTB_REVERSED_BYTES_SIZE, ZoomPatch } from "./ZoomPatch.js";


export class ZoomPatchConverter
{

  private patchConverterMap: Map<number, any>; // FIXME: Use proper type instead of any

  private parameterMapObj = {
    "Level" : "VOL",
    "PreD" : "Pre DLY",
    "FLTR" : "Filter",
    "Fdbk" : "Repeat",
    "DlyMx" : "DLY Mix",
    "TimeA" : "Time A",
    "TimeB" : "Time B",
  }

  private parameterConverterMap: Map<string, string>;

  constructor()
  {
    this.patchConverterMap = zoomPatchConverterMap;

    this.parameterConverterMap = new Map<string, string>(Object.entries(this.parameterMapObj));
  }

  convert(inputPatch: ZoomPatch): ZoomPatch | undefined
  {
    if (inputPatch.MSOG === null) {
      shouldLog(LogLevel.Error) && console.error(`Patch conversion only possible for patches from the original MS pedals`);
      return undefined;
    }

    let effectIDMapPlus = ZoomDevice.getEffectIDMapForDevice("MS-70CDR+");
    if (effectIDMapPlus === undefined) {
      shouldLog(LogLevel.Error) && console.error(`No effect ID map found for device MS-70CDR+`);
      return undefined;
    }

    let effectIDMapOG = ZoomDevice.getEffectIDMapForDevice("MS-70CDR");
    if (effectIDMapOG === undefined) {
      shouldLog(LogLevel.Error) && console.error(`No effect ID map found for device MS-70CDR`);
      return undefined;
    }

    let outputPatch: ZoomPatch = ZoomPatch.createEmptyPTCFPatch();

    outputPatch.name = inputPatch.name;
    outputPatch.tempo = inputPatch.tempo;
    outputPatch.descriptionEnglish = inputPatch.descriptionEnglish;
    outputPatch.currentEffectSlot = inputPatch.currentEffectSlot;

    outputPatch.updatePatchPropertiesFromDerivedProperties();

    if (outputPatch.effectSettings === null || outputPatch.ids === null || outputPatch.edtbReversedBytes === null) {
      shouldLog(LogLevel.Error) && console.error(`outputPatch.effectSettings === null || outputPatch.ids === null || outputPatch.edtbReversedBytes === null. This should never happen.`);
      return undefined;
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
          outputEffect.id = map.msplusID;
          outputEffect.enabled = inputEffect.enabled;
          
          let inputEffectMap = effectIDMapOG.get(inputEffect.id);
          if (inputEffectMap === undefined) {
            shouldLog(LogLevel.Warning) && console.warn(`No mapping found for MSOG effect ID ${inputEffect.id} in slot ${slotNumber} patch "${inputPatch.name}"`);
            continue;
          }
          
          let outputEffectMap = effectIDMapPlus.get(outputEffect.id);
          if (outputEffectMap === undefined) {
            shouldLog(LogLevel.Warning) && console.warn(`No mapping found for MS+ effect ID ${outputEffect.id} in slot ${slotNumber} patch "${inputPatch.name}"`);
            continue;
          }
          
          shouldLog(LogLevel.Info) && console.log(`Mapping patch "${inputPatch.name}" slot ${slotNumber} effect ID ${inputEffect.id} "${inputEffectMap.name}" `+
            `-> effect ID ${outputEffect.id} "${outputEffectMap.name}"`);

          ZoomDevice.setDefaultsForEffect(outputEffect, effectIDMapPlus);

          // Loop through parameters and map
          for (let parameterIndex = 0; parameterIndex < inputEffectMap.parameters.length; parameterIndex++) {
            let inParamVal = inputEffect.parameters[parameterIndex];
            let inParamMap = inputEffectMap.parameters[parameterIndex];

            let outputParameterIndex: number;

            if (inputEffectMap.name === "OptComp" && inParamMap.name === "Tone") { 
              outputParameterIndex = outputEffectMap.parameters.findIndex(parameterMap => parameterMap.name === "Hi"); 
            }
            else {
              outputParameterIndex = outputEffectMap.parameters.findIndex(parameterMap => {
                return parameterMap.name.toLowerCase() === inParamMap.name.toLowerCase() || 
                parameterMap.name === this.parameterConverterMap.get(inParamMap.name);
              });
            }

            if (outputParameterIndex === -1) {
              let alternatives = "";
              outputEffectMap.parameters.forEach(parameterMap => {
                  alternatives += ` ${parameterMap.name}`;
              })
              shouldLog(LogLevel.Info) && console.log(`  Parameter ${parameterIndex} ${inParamMap.name.padStart(8)} = ` +
                `${inParamVal.toString(10).padStart(4, " ")} -> No matching output parameter found. Alternatives:${alternatives}.`);
              continue;
            }

            let outParamMap = outputEffectMap.parameters[outputParameterIndex];
            
            let outParamVal: number | undefined = undefined;
            let useLinearInterpolaton = false;
            let explanation = "";

            if (inParamMap.maxNumerical === undefined || inParamVal > inParamMap.maxNumerical) {
              // The input value is a text-value, not a numerical value
              let inParamValString = inParamMap.values[inParamVal];
              let index = outParamMap.values.indexOf(inParamValString)
              if (index !== -1) {
                let outParamValString = outParamMap.values[index];
                let [value, max] = ZoomDevice.getRawParameterValueFromStringAndMap(effectIDMapPlus, outputEffect.id, outputParameterIndex + 2, outParamValString);
                if (max !== -1) {
                  outParamVal = value;
                }
                else {
                  useLinearInterpolaton = true;
                  explanation = `Unable to calculate numerical value for output value string "$outnParamValString}"`
                }
              }
              else {
                useLinearInterpolaton = true;
                explanation = `Input value string "${inParamValString}" not found in output values list`
              }
            }
            else
              useLinearInterpolaton = true;

            if (useLinearInterpolaton) {
              // Straight up linear interpolation with a breakpoint at (inputEffectMap.default, outputEffectMap.default)
              if (inParamMap.default === undefined || outParamMap.default === undefined || inParamMap.max === inParamMap.default || outParamMap.max === outParamMap.default)
                outParamVal = Math.round(inParamVal / inParamMap.max * outParamMap.max);
              else if (inParamVal < inParamMap.default)
                outParamVal = Math.round(inParamVal / inParamMap.default * outParamMap.default)
              else
                outParamVal = Math.round((inParamVal - inParamMap.default) / (inParamMap.max - inParamMap.default) * (outParamMap.max - outParamMap.default) + outParamMap.default);
            }

            if (outParamVal === undefined) {
              shouldLog(LogLevel.Error) && console.error(`  outParamVal === undefined for param ${parameterIndex} ${inParamMap.name.padStart(8)} (${inParamMap.default}) = `+
                `${inParamVal.toString(10).padStart(4, " ")}. This should never hapen!`);
              continue;
            }

            if (isNaN(outParamVal)) {
              shouldLog(LogLevel.Error) && console.error(`  outParamVal is not a number for param ${parameterIndex} ${inParamMap.name.padStart(8)} (${inParamMap.default}) = `+
                `${inParamVal.toString(10).padStart(4, " ")}. This should never hapen!`);
              continue;
            }

            outputEffect.parameters[outputParameterIndex] = outParamVal;

            shouldLog(LogLevel.Info) && console.log(`  Param ${parameterIndex} ${inParamMap.name.padStart(8)} (${inParamMap.default?.toString(10).padStart(4, " ")}) = `+
              `${inParamVal.toString(10).padStart(4, " ")} -> Param ${outputParameterIndex } ${outParamMap.name.padStart(8)} (${outParamMap.default?.toString(10).padStart(4, " ")}) = ` +
              `${outParamVal.toString(10).padStart(4, " ")} ${explanation}`);
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
      return undefined;
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

    return outputPatch;
  }
}