/*

Simple measurement of performance.

Use-cases:
- measure time spent in midi send
- measure time between midi receive and next midi send
- measure between midi send and next midi send
- measure time between midi in and next midi in

Requirements:
- minimal overhead, fast lookup, no GC

- enter/exit

*/

export const MIDI_SEND = 0;
export const MIDI_RECEIVE = 1;
export const MIDI_RECEIVE_TO_SEND = 2;
export const MIDI_TIMESTAMP_TO_RECEIVE = 3;

const NUM_COUNTERS = 100;

export class CounterInfo
{
  public lastTime: number = 0;

  public insideSum: number = 0;
  public insideCount: number = 0;
  public insideMin: number = 10000000;
  public insideMax: number = 0;
  public insideLatest: number = 0;

  public periodSum: number = 0;
  public periodCount: number = 0;
  public periodMin: number = 10000000;
  public periodMax: number = 0;
  public periodLatest: number = 0;

  public constructor()
  {
    this.reset();
  }

  public reset()
  {
    this.lastTime = 0; 

    this.insideSum = 0;
    this.insideCount = 0;
    this.insideMin = 10000000;
    this.insideMax = 0;
    this.insideLatest = 0;

    this.periodSum = 0;
    this.periodCount = 0;
    this.periodMin = 10000000;
    this.periodMax = 0;
    this.periodLatest = 0;
  }

  public get insideAverage(): number
  { 
    return this.insideSum / this.insideCount; 
  }

  public get periodAverage(): number
  { 
    return this.periodSum / this.periodCount; 
  }
}

export class PerformanceMonitor
{
  private counters: CounterInfo[] = new Array<CounterInfo>(NUM_COUNTERS);
  
  public enabled: boolean = true;

  public constructor()
  {
    for (let i = 0; i < NUM_COUNTERS; i++)
      this.counters[i] = new CounterInfo();
  }

  public enable(enable: boolean = true)
  {
    this.enabled = enable;
  }

  public resetCounter(counter: number)
  {
    this.counters[counter].reset();
  }

  public resetAllCounters()
  {
    for (let i = 0; i < NUM_COUNTERS; i++)
      this.counters[i].reset();
  }

  public enter(counter: number)
  {
    if (!this.enabled)
      return;

    let info = this.counters[counter];

    if (info.lastTime === 0) {
      info.lastTime = performance.now();
      return;
    }

    let now = performance.now();
    let diff = now - info.lastTime;

    info.periodSum += diff;
    info.periodMin = Math.min(info.periodMin, diff);
    info.periodMax = Math.max(info.periodMax, diff);
    info.periodLatest = diff;

    info.periodCount++;

    info.lastTime = now;
  }

  public exit(counter: number)
  {
    if (!this.enabled)
      return;

    let info = this.counters[counter];

    if (info.lastTime === 0) {
      // We haven't seen an enter yet, so we cannot measure time inside (between enter and exit)
      return;
    }


    let now = performance.now();
    let diff = now - info.lastTime;

    info.insideSum += diff;
    info.insideMin = Math.min(info.insideMin, diff);
    info.insideMax = Math.max(info.insideMax, diff);
    info.insideLatest = diff;

    info.insideCount++;
  }

  public exitWithExplicitLastTimeInside(counter: number, lastTime: number)
  {
    if (!this.enabled)
      return;

    let info = this.counters[counter];
    info.lastTime = lastTime;

    let now = performance.now();
    let diff = now - info.lastTime;
    diff = diff >= 0 ? diff : 0;

    info.insideSum += diff;
    info.insideMin = Math.min(info.insideMin, diff);
    info.insideMax = Math.max(info.insideMax, diff);
    info.insideLatest = diff;

    info.insideCount++;
  }

  public getCounterInfo(counter: number): CounterInfo
  {
    return this.counters[counter];
  }

  public resolution(): number
  {
    const NUM_SAMPLES = 10000;
    let samples = new Array<number>(NUM_SAMPLES);
  
    for (let i=0; i<NUM_SAMPLES; i++)
      samples[i] = performance.now();
  
    let set = new Set(samples);
    let uniqueSamples = set.size;
  
    let diff = samples[NUM_SAMPLES-1] - samples[0];
    let resolution = diff / uniqueSamples;
    
    return resolution;
  }
  
}

export let perfmon = new PerformanceMonitor();
