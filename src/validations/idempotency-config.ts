import type { IAppConfig } from '../config/configuration.js';

export interface IIdempotencyConfig {
  readonly hashSecret: string;
}

/**
 * Returns the idempotency settings, failing with a readable error when the
 * HMAC secret is missing. The base schema keeps it optional so HTTP-only code
 * paths never depend on it. The error never includes the secret.
 */
export function requireIdempotencyConfig(
  config: IAppConfig,
): IIdempotencyConfig {
  const { hashSecret } = config.idempotency;
  if (hashSecret === undefined) {
    throw new Error('Validations require IDEMPOTENCY_HASH_SECRET to be set');
  }
  return { hashSecret };
}
