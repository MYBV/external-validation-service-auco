import type { ICountryEnrichment } from '../../enrichment/interfaces/country-enrichment.interface.js';

/**
 * Persisted validation record. The enrichment is geographic data about the
 * selected country, not identity verification. `idempotencyKey` and
 * `requestFingerprint` are internal and never leave the API.
 */
export interface IValidation {
  name: string;
  documentNumber: string;
  countryCode: string;
  enrichment: ICountryEnrichment;
  createdAt: Date;
  idempotencyKey?: string;
  requestFingerprint?: string;
}

/** Public representation returned by GET /validations/:id. */
export interface IValidationResponse {
  id: string;
  name: string;
  documentNumber: string;
  countryCode: string;
  enrichment: ICountryEnrichment;
  createdAt: Date;
}

/** Response of POST /validations. */
export interface ICreatedValidation {
  id: string;
}

/** Input of the create use case; values are already validated by Zod. */
export interface ICreateValidationInput {
  countryCode: string;
  name: string;
  documentNumber: string;
  idempotencyKey?: string;
}
