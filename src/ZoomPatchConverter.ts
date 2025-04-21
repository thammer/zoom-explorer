import { LogLevel, shouldLog } from "./Logger.js";
import { EffectSettings, PTCF_EDTB_REVERSED_BYTES_SIZE, ZoomPatch } from "./ZoomPatch.js";

export class ZoomPatchConverter
{

  private patchMapObj = {
    "06000100": {
      msogName: "Vibrato",
      msplusID: "06000111",
      msplusName: "Vibrato",
    }
  };

  patchConverterMap: Map<number, any>; // FIXME: Use proper type instead of any

  constructor()
  {
    this.patchConverterMap = new Map<number, any>(Object.entries(this.patchMapObj).map(([key, value]) => {
      (value as any).msplusID = parseInt(value.msplusID, 16); 
      return [parseInt(key, 16), value as any];
    }));
  }

  convert(inputPatch: ZoomPatch): ZoomPatch | undefined
  {
    if (inputPatch.MSOG === null) {
      shouldLog(LogLevel.Error) && console.error(`Patch conversion only possible for patches from the original MS pedals`);
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
        // let inputEffectID = inputEffect.id;
        let inputEffectID = 0x06000100;
        let outputEffect = new EffectSettings();

        // Look up inputEffect.id and find a matching output ID
        let map = this.patchConverterMap.get(inputEffectID);

        if (map === undefined) {
          shouldLog(LogLevel.Info) && console.log(`No conversion mapping found for effect ID ${inputEffectID} in slot ${slotNumber} patch "${inputPatch.name}". Inserting empty effect.`);
          outputEffect.id = 0x00000000;
          outputEffect.enabled = false;
          outputEffect.parameters = new Array<number>(12);
          outputEffect.parameters.fill(0); 
        }
        else {
          outputEffect.id = map.msplusID;
          outputEffect.enabled = inputEffect.enabled;
          outputEffect.parameters = new Array<number>(12);
          outputEffect.parameters.fill(0); 
          shouldLog(LogLevel.Info) && console.log(`Mapping patch "${inputPatch.name}" slot ${slotNumber} effect ID ${inputEffectID} -> effect ID ${outputEffect.id}`);
          
          // Loop through parameters and map

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
      shouldLog(LogLevel.Error) && console.error(`Unable to build PRM2 patch buffer. Inconsistent patch data for patch ${outputPatch.name}.`);
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