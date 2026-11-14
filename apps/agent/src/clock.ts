/**
 * Time, injected. The loop never calls Date.now() or setTimeout directly, so
 * tests can drive a virtual clock and run "ten minutes" of work instantly.
 */
export interface Clock {
  now(): number;
  /**
   * Wait `ms`, or less if `signal` aborts. Never rejects: callers check
   * `signal.aborted` afterwards. That keeps the loop free of try/catch noise
   * around every sleep.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener("abort", done, { once: true });
    }),
};
