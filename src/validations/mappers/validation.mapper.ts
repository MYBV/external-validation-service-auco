import type { WithId } from 'mongodb';
import type {
  IValidation,
  IValidationResponse,
} from '../interfaces/validation.interface.js';

/**
 * Explicit allow-list: internal fields (`_id`, idempotency key and
 * fingerprint) are never copied by accident.
 */
export function toValidationResponse(
  validation: WithId<IValidation>,
): IValidationResponse {
  return {
    id: validation._id.toHexString(),
    name: validation.name,
    documentNumber: validation.documentNumber,
    countryCode: validation.countryCode,
    enrichment: validation.enrichment,
    createdAt: validation.createdAt,
  };
}
