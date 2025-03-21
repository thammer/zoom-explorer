import { shouldLog, LogLevel } from "./Logger.js";
import { EffectIDMap, EffectParameterMap } from "./ZoomDevice.js";

/**
 * Add some extra IDs for MS-60B effects.
 * @param mapForMSOG 
 * @see https://github.com/thammer/zoom-explorer/issues/3
 */
export function extendMSOGMapWithMS60BEffects(mapForMSOG: Map<number, EffectParameterMap>)
{
    let map: Map<string, string> = new Map<string, string>();
    map.set("05000080", "05100080");
    map.set("05000010", "05100010");
    map.set("0c000010", "01400010");
    map.set("0d000010", "01600010");
    map.set("05000090", "05100090");
    map.set("0c000090", "01400090");
    map.set("03000020", "014000a0");
    map.set("05000020", "05100020");
    map.set("0c000020", "01400020");
    map.set("0d000020", "01600020");
    map.set("050000a0", "051000a0");
    map.set("05000030", "05100030");
    map.set("0c000030", "01400030");
    map.set("0d000030", "01600030");
    map.set("050000b0", "051000b0");
    map.set("05000040", "05100040");
    map.set("0d000040", "01600040");
    map.set("050000c0", "051000c0");
    map.set("0c0000c0", "014000c0");
    map.set("03000050", "01400050");
    map.set("05000050", "05100050");
    map.set("0d000050", "01600050");
    map.set("03000060", "014000b0");
    map.set("05000060", "05100060");
    map.set("0d000060", "01600060");
    map.set("05000070", "05100070");

    for (const [msogIDString, ms60bIDString] of map) {
      let msogID = parseInt(msogIDString, 16);
      let ms60bID = parseInt(ms60bIDString, 16);
      
      let parameterMap: EffectParameterMap | undefined = mapForMSOG.get(msogID);
      if (parameterMap === undefined) {
        shouldLog(LogLevel.Warning) && console.warn(`No mapping for MS-OG ID ${msogIDString}`);
        continue;
      }

      let controlMap: EffectParameterMap | undefined = mapForMSOG.get(ms60bID);
      if (controlMap !== undefined) {
        shouldLog(LogLevel.Warning) && console.warn(`Duplicate mapping found for MS-60B ID ${ms60bIDString}`);
        continue;
      }

      mapForMSOG.set(ms60bID, parameterMap);
    }
}

function isPositiveInteger(str: string): boolean
{
  return /^\d+$/.test(str);
}

function isNumerical(str: string): boolean
{
  return !isNaN(Number(str));
}

export function extendMapWithMaxNumericalValueIndex(map: EffectIDMap): void
{
  for (const [id, effect] of map) {
    let effectName = effect.name;
    let parameters = effect.parameters;
    for (let parameterNumber = 0; parameterNumber < parameters.length; parameterNumber++) {
      let parameter = parameters[parameterNumber];
      let parameterName = parameter.name;
      let values = parameter.values;
      let valueAsNumber: number;
      let lastValueAsNumber: number;
      let delta = 0;
      if (values.length == 0 || !isNumerical(values[0])) {
        parameter.maxNumerical = undefined;
        continue;
      }

      valueAsNumber = Number.parseInt(values[0]);
      parameter.maxNumerical = 0;
      lastValueAsNumber = valueAsNumber;

      for (let valueNumber = 1; valueNumber < values.length; valueNumber++) {
        let valueAsString = values[valueNumber];
        if (!isNumerical(valueAsString)) {
          break;
        }
        parameter.maxNumerical = valueNumber;
        valueAsNumber = Number.parseFloat(valueAsString);
        if (valueNumber === 1)
          delta = valueAsNumber - lastValueAsNumber;

        if (valueAsNumber - lastValueAsNumber !== delta) {
          // console.info(`Values for parameter ${parameterName} effect ${effectName} ID ${id} are not evenly spaced. Previous delta ${delta}, current delta ${valueAsNumber - lastValueAsNumber}`);
          delta = valueAsNumber - lastValueAsNumber;
        }
        lastValueAsNumber = valueAsNumber;
      }
      if (parameter.maxNumerical !== undefined && parameter.maxNumerical !== parameter.max) {
        console.log(`${effectName.padEnd(12)} ${parameterName.padEnd(10)} ${parameter.maxNumerical.toString().padEnd(5)}: ${parameter.values[parameter.maxNumerical].padEnd(5)} -> ${parameter.values[parameter.maxNumerical + 1]}`);
      }
    }
  }
}



// Currently unused
// function earlyAttemptAtExtendMapWithMinMaxNumericalValues(map: EffectIDMap): void
// {
//   for (const [id, effect] of map) {
//     let effectName = effect.name;
//     let parameters = effect.parameters;
//     for (let parameterNumber = 0; parameterNumber < parameters.length; parameterNumber++) {
//       let parameter = parameters[parameterNumber];
//       let parameterName = parameter.name;
//       let values = parameter.values;
//       let valueAsNumber: number;
//       let lastValueAsNumber: number;
//       let delta = 0;
//       if (values.length == 0 || !isPositiveInteger(values[0])) {
//         parameter.minNumericalValue = undefined;
//         parameter.maxNumericalValue = undefined;
//         continue;
//       }

//       valueAsNumber = Number.parseInt(values[0]);
//       parameter.minNumericalValue = valueAsNumber;
//       parameter.maxNumericalValue = valueAsNumber;
//       lastValueAsNumber = valueAsNumber;

//       for (let valueNumber = 1; valueNumber < values.length; valueNumber++) {
//         let valueAsString = values[valueNumber];
//         if (!isPositiveInteger(valueAsString)) {
//           break;
//         }
//         valueAsNumber = Number.parseInt(valueAsString);
//         if (valueNumber === 1)
//           delta = valueAsNumber - lastValueAsNumber;

//         if (valueAsNumber - lastValueAsNumber !== delta) {
//           console.warn(`Values for parameter ${parameterName} effect ${effectName} ID ${id} are not evenly spaced`);
//           parameter.minNumericalValue = undefined;
//           parameter.maxNumericalValue = undefined;
//           break;
//         }
//         lastValueAsNumber = valueAsNumber;
//       }
//     }
//   }
// }
