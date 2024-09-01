
type ReleaseFunctionType = () => void;
type ResolveFunctionType = (release: ReleaseFunctionType) => void;

/**
 * Runs async functions in sequence, making sure to not run a new function before all previous functions have finished (promises resolved)
 * @see'https://dev.to/0916dhkim/simple-typescript-mutex-implementation-5544
 */
export class SequentialAsyncRunner
{
  private _locked = false;
  private _resolveQueue: Array<ResolveFunctionType> = new Array<ResolveFunctionType>();

  private dispatch(): void
  {
    if (this._locked)
      return;

    let resolve = this._resolveQueue.shift();

    if (resolve === undefined)
      return;

    this._locked = true;

    resolve(() => {
      this._locked = false;
      this.dispatch();
    });
  }

  private acquireLock(): Promise<ReleaseFunctionType>
  {
    return new Promise<ReleaseFunctionType>((resolve: ResolveFunctionType) => {
      this._resolveQueue.push(resolve);
      this.dispatch();
    });
  }

  public async run<T>(func: () => Promise<T>): Promise<T>
  {
    // wait until all queued resolvers are done
    let release = await this.acquireLock();
    // call func() and run the code that awaits func() - that's how Promises work with await
    try {
      return await func();
    }
    finally {
      // when the code that awaits func() is done, call release(), which will release the lock and run next queued resolver (if any)
      release();
    }


    // let result = await func();
    // release();
    // return result;
  }
  
}