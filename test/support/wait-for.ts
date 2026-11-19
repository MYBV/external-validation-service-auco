import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Polls `check` until it returns a value other than undefined, with a bounded
 * total wait. It is meant for asserting the *final* state of work that may
 * still be running in the background (for example an inline operation that
 * outlived its budget), instead of racing against it with fixed sleeps.
 */
export async function waitFor<T>(
  check: () => Promise<T | undefined>,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 10000, intervalMs = 50 } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Condition not met within ${timeoutMs} ms`);
    }
    await sleep(intervalMs);
  }
}
