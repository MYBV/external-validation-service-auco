import { createHmac } from 'node:crypto';

export interface IFingerprintInput {
  readonly countryCode: string;
  readonly name: string;
  readonly documentNumber: string;
}

/** Version prefix so the algorithm or canonical form can evolve. */
export const FINGERPRINT_VERSION = 'v1';

/**
 * Deterministic HMAC-SHA256 of the logical content of a creation request:
 * country code (uppercase), name (trimmed, NFC) and document number (trimmed),
 * serialised in a fixed key order. The Idempotency-Key, the request id and
 * transport headers are excluded. Only the digest is stored, never the body.
 */
export function computeRequestFingerprint(
  secret: string,
  input: IFingerprintInput,
): string {
  const canonical = JSON.stringify({
    v: 1,
    countryCode: input.countryCode.trim().toUpperCase(),
    name: input.name.trim().normalize('NFC'),
    documentNumber: input.documentNumber.trim(),
  });
  const digest = createHmac('sha256', secret).update(canonical).digest('hex');
  return `${FINGERPRINT_VERSION}:${digest}`;
}
