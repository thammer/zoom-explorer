import { shouldLog, LogLevel } from "./Logger.js";

export type ThrotlerCallbackType = () => void;

/**
 * @example Patterns:
 * - Alt 1: Call latest callback after initial timeoutMilliseconds
 *   - doItLater is called multiple times, 
 *   - callback is overwritten
 *   - timeoutMillisecons ms after the first call, the latest callback is called
 * - At 2: Reset timer and call latest callback after timeoutMilliseconds from the last call
 *   - doItLater is called multiple times
 *   - callback is overwritten
 *   - old timeout is canceled and a new one is created with timeoutMilliseconds 
 *   - timeoutMillisecons ms after the last call, the latest callback is called
 * 
 * Ideas:
 * - throtler could keep a map with ongoing timeouts, indexed by a given string (throttle id or something easy to understand)
 * - or probably more custom stuff for MIDI
 * - optionally fire the first callback right away, then the rest are throtled (only sent if doItLater is called a second (or more) time(s))
 */
export class Throttler
{
  private lastTime: DOMHighResTimeStamp | undefined = undefined;
  private timeoutId: number | undefined = undefined;
  private callback: ThrotlerCallbackType | undefined = undefined;

  constructor()
  {
    this.lastTime = performance.now();
  }

  doItLater(callback: ThrotlerCallbackType, timeoutMilliseconds: number)
  {
    this.callback = callback;
    if (this.timeoutId === undefined) {
      this.timeoutId = setTimeout( () => {
        this.timeoutId = undefined;
        shouldLog(LogLevel.Info) && console.log(`Throtler timed out (${this.timeoutId}) after "${timeoutMilliseconds} ms"`);
        if (this.callback !== undefined) {
          let actualCallback = this.callback;
          this.callback = undefined;
          shouldLog(LogLevel.Info) && console.log(`Throtler calling callback ${actualCallback}`);
          actualCallback();
        }
      }, timeoutMilliseconds);
    }
  }
}
