import { z } from 'zod';
import {
  COUNTRY_CODE_HEADER,
  IDEMPOTENCY_KEY_HEADER,
} from '../../common/constants/headers.constants.js';
import { countryCodeSchema } from '../../countries/schemas/country-code.schema.js';
import { idempotencyKeySchema } from './idempotency-key.schema.js';

/**
 * Headers of POST /validations. `x-country-code` is mandatory here (and only
 * here); `Idempotency-Key` is optional. Other headers are ignored.
 */
export const createValidationHeadersSchema = z.object({
  [COUNTRY_CODE_HEADER]: countryCodeSchema,
  [IDEMPOTENCY_KEY_HEADER]: idempotencyKeySchema,
});

export type CreateValidationHeaders = z.infer<
  typeof createValidationHeadersSchema
>;
