import {
  AUDIT_BACKOFF_BASE_MS,
  computeBackoffMs,
} from './audit-backoff.util.js';

const MIDDLE = () => 0.5; // zero jitter

describe('computeBackoffMs', () => {
  it('starts at the base delay and doubles per attempt', () => {
    expect(computeBackoffMs(1, 300000, MIDDLE)).toBe(AUDIT_BACKOFF_BASE_MS);
    expect(computeBackoffMs(2, 300000, MIDDLE)).toBe(AUDIT_BACKOFF_BASE_MS * 2);
    expect(computeBackoffMs(4, 300000, MIDDLE)).toBe(AUDIT_BACKOFF_BASE_MS * 8);
  });

  it('never exceeds the configured cap, even with positive jitter', () => {
    expect(computeBackoffMs(30, 60000, MIDDLE)).toBe(60000);
    expect(computeBackoffMs(30, 60000, () => 0.999)).toBeLessThanOrEqual(60000);
  });

  it('keeps jitter within +-20 %', () => {
    expect(computeBackoffMs(1, 300000, () => 0)).toBe(4000);
    expect(computeBackoffMs(1, 300000, () => 0.999999)).toBeLessThanOrEqual(
      6000,
    );
  });

  it('treats a zero or negative attempt count as the first attempt', () => {
    expect(computeBackoffMs(0, 300000, MIDDLE)).toBe(AUDIT_BACKOFF_BASE_MS);
  });
});
