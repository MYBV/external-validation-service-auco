import { MongoServerError, ObjectId } from 'mongodb';
import type { IOutboxEvent } from '../../src/audit/interfaces/outbox-event.interface.js';
import type { ICountry } from '../../src/countries/interfaces/country.interface.js';
import type { ICountryEnrichment } from '../../src/enrichment/interfaces/country-enrichment.interface.js';
import type { IValidation } from '../../src/validations/interfaces/validation.interface.js';

export const SAMPLE_ENRICHMENT: ICountryEnrichment = {
  source: 'rest-countries',
  code: 'CO',
  commonName: 'Colombia',
  officialName: 'Republic of Colombia',
  region: 'Americas',
  subregion: 'South America',
  capitals: ['Bogota'],
  languages: ['Spanish'],
  currencies: [{ code: 'COP', name: 'Colombian peso' }],
  enrichedAt: new Date('2026-01-01T00:00:00.000Z'),
};

/** Fake of the provider-facing service: no network, no REST Countries key. */
export function makeRestCountriesFake() {
  return {
    enrich: vi.fn<(code: string) => Promise<ICountryEnrichment>>((code) =>
      Promise.resolve({ ...SAMPLE_ENRICHMENT, code }),
    ),
  };
}

/** In-memory country catalog: CO enabled, MX disabled, anything else unknown. */
export function makeCountryRepositoryFake() {
  const now = new Date();
  const catalog: Record<string, ICountry> = {
    CO: {
      code: 'CO',
      name: 'Colombia',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    MX: {
      code: 'MX',
      name: 'Mexico',
      enabled: false,
      createdAt: now,
      updatedAt: now,
    },
  };
  return {
    findByCode: (code: string) => {
      const country = catalog[code];
      return Promise.resolve(
        country === undefined ? null : { _id: new ObjectId(), ...country },
      );
    },
  };
}

/** In-memory ValidationRepository; the unique idempotency index is emulated. */
export function makeValidationRepositoryFake() {
  const rows: Array<IValidation & { _id: ObjectId }> = [];
  return {
    rows,
    create: (document: IValidation & { _id?: ObjectId }): Promise<ObjectId> => {
      if (
        document.idempotencyKey !== undefined &&
        rows.some((row) => row.idempotencyKey === document.idempotencyKey)
      ) {
        return Promise.reject(
          new MongoServerError({
            message: 'E11000 duplicate key error',
            code: 11000,
            keyPattern: { idempotencyKey: 1 },
          }),
        );
      }
      const _id = document._id ?? new ObjectId();
      rows.push({ ...document, _id });
      return Promise.resolve(_id);
    },
    findById: (id: ObjectId) =>
      Promise.resolve(rows.find((row) => row._id.equals(id)) ?? null),
    findByIdempotencyKey: (key: string) =>
      Promise.resolve(rows.find((row) => row.idempotencyKey === key) ?? null),
  };
}

export function makeOutboxRepositoryFake() {
  const rows: Array<IOutboxEvent & { _id: ObjectId }> = [];
  return {
    rows,
    create: (document: IOutboxEvent): Promise<ObjectId> => {
      const _id = new ObjectId();
      rows.push({ ...document, _id });
      return Promise.resolve(_id);
    },
  };
}
