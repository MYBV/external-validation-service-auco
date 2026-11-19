import { z } from 'zod';

/** Optional Idempotency-Key header: 8-128 characters of [A-Za-z0-9_.:-]. */
export const idempotencyKeySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_.:-]{8,128}$/,
    'Must be 8-128 characters of letters, digits, "_", ".", ":" or "-"',
  )
  .optional();
