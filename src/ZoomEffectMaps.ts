import { shouldLog, LogLevel } from "./Logger.js";
import { EffectParameterMap } from "./ZoomDevice.js";

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

