/** First retry delay; doubles on every attempt up to the configured cap. */
export const AUDIT_BACKOFF_BASE_MS = 5000;
/** Jitter spread: the delay varies by +-20 % to avoid synchronised retries. */
const JITTER_RATIO = 0.2;

/**
 * Delay before the next attempt. `attempts` is the number of attempts already
 * made (the claim counts the current one), so the first failure waits the
 * base delay. `random` returns a value in [0, 1) and is injectable for tests.
 */
export function computeBackoffMs(
  attempts: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempts - 1);
  const capped = Math.min(AUDIT_BACKOFF_BASE_MS * 2 ** exponent, maxMs);
  const jitter = 1 + (random() * 2 - 1) * JITTER_RATIO;
  return Math.min(Math.round(capped * jitter), maxMs);
}
