import { ObjectId } from 'mongodb';
import { makeAppConfig } from '../../test/support/app-config.js';
import { validateEnv } from '../config/env.schema.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { requireIdempotencyConfig } from './idempotency-config.js';
import type { IValidation } from './interfaces/validation.interface.js';
import { toValidationResponse } from './mappers/validation.mapper.js';
import { OutboxRepository } from '../audit/repositories/outbox.repository.js';
import type { MongoService } from '../database/mongo/mongo.service.js';
import {
  IDEMPOTENCY_KEY_INDEX,
  ValidationRepository,
} from './repositories/validation.repository.js';
import { createValidationHeadersSchema } from './schemas/create-validation-headers.schema.js';
import { createValidationSchema } from './schemas/create-validation.schema.js';
import { idempotencyKeySchema } from './schemas/idempotency-key.schema.js';
import { validationIdSchema } from './schemas/validation-id.schema.js';
import { computeRequestFingerprint } from './utils/request-fingerprint.util.js';

const SECRET = 's'.repeat(40);
const BASE = { countryCode: 'CO', name: 'Ana Perez', documentNumber: '123' };

describe('request fingerprint', () => {
  it('is a deterministic v1 HMAC-SHA256 hex digest', () => {
    const fingerprint = computeRequestFingerprint(SECRET, BASE);

    expect(fingerprint).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(computeRequestFingerprint(SECRET, BASE)).toBe(fingerprint);
  });

  it('normalises equivalent content', () => {
    const reference = computeRequestFingerprint(SECRET, BASE);

    expect(
      computeRequestFingerprint(SECRET, {
        countryCode: ' co ',
        name: '  Ana Perez ',
        documentNumber: ' 123 ',
      }),
    ).toBe(reference);
    // NFC: "é" composed vs decomposed.
    expect(computeRequestFingerprint(SECRET, { ...BASE, name: 'José' })).toBe(
      computeRequestFingerprint(SECRET, { ...BASE, name: 'José' }),
    );
  });

  it.each([
    ['country', { ...BASE, countryCode: 'MX' }],
    ['name', { ...BASE, name: 'Ana Perez Q' }],
    ['name case', { ...BASE, name: 'ana perez' }],
    ['document', { ...BASE, documentNumber: '124' }],
  ])('changes when the %s changes', (_label, other) => {
    expect(computeRequestFingerprint(SECRET, other)).not.toBe(
      computeRequestFingerprint(SECRET, BASE),
    );
  });

  it('depends on the secret and does not contain the content', () => {
    const a = computeRequestFingerprint(SECRET, BASE);
    const b = computeRequestFingerprint('t'.repeat(40), BASE);

    expect(a).not.toBe(b);
    expect(a).not.toContain('Ana');
  });

  it('cannot be confused across fields', () => {
    expect(
      computeRequestFingerprint(SECRET, {
        countryCode: 'CO',
        name: 'a',
        documentNumber: 'bc',
      }),
    ).not.toBe(
      computeRequestFingerprint(SECRET, {
        countryCode: 'CO',
        name: 'ab',
        documentNumber: 'c',
      }),
    );
  });
});

describe('IDEMPOTENCY_HASH_SECRET configuration', () => {
  it('is optional in the base schema and enforced by the validations module', () => {
    const config = makeAppConfig();

    expect(config.idempotency.hashSecret).toBeUndefined();
    expect(() => requireIdempotencyConfig(config)).toThrow(
      'IDEMPOTENCY_HASH_SECRET',
    );
  });

  it('reads a valid secret', () => {
    const config = makeAppConfig({ IDEMPOTENCY_HASH_SECRET: SECRET });

    expect(requireIdempotencyConfig(config)).toEqual({ hashSecret: SECRET });
  });

  it('rejects a short secret without echoing it', () => {
    const error: unknown = (() => {
      try {
        validateEnv({
          API_KEY: 'k'.repeat(32),
          IDEMPOTENCY_HASH_SECRET: 'too-short-secret',
        });
        return undefined;
      } catch (caught: unknown) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('IDEMPOTENCY_HASH_SECRET');
    expect((error as Error).message).not.toContain('too-short-secret');
  });
});

describe('create validation schemas', () => {
  it('trims and accepts a valid body', () => {
    expect(
      createValidationSchema.parse({ name: ' Ana ', documentNumber: ' 1-2 ' }),
    ).toEqual({ name: 'Ana', documentNumber: '1-2' });
  });

  it.each([
    {},
    { name: 'Ana' },
    { name: '', documentNumber: '1' },
    { name: 'Ana', documentNumber: '' },
    { name: 'a'.repeat(121), documentNumber: '1' },
    { name: 'Ana', documentNumber: '1'.repeat(65) },
    { name: 'Ana', documentNumber: '1', extra: true },
    { name: 'An\na', documentNumber: '1' },
    { name: 'A\u0007na', documentNumber: '1' },
    { name: 1, documentNumber: '1' },
  ])('rejects the body %j', (body) => {
    expect(createValidationSchema.safeParse(body).success).toBe(false);
  });

  it('accepts the maximum lengths', () => {
    expect(
      createValidationSchema.safeParse({
        name: 'a'.repeat(120),
        documentNumber: '1'.repeat(64),
      }).success,
    ).toBe(true);
  });

  it('requires x-country-code and normalises it', () => {
    expect(
      createValidationHeadersSchema.parse({ 'x-country-code': ' co ' }),
    ).toEqual({ 'x-country-code': 'CO' });
    expect(createValidationHeadersSchema.safeParse({}).success).toBe(false);
    expect(
      createValidationHeadersSchema.safeParse({ 'x-country-code': 'COL' })
        .success,
    ).toBe(false);
  });

  it('ignores unrelated headers', () => {
    expect(
      createValidationHeadersSchema.parse({
        'x-country-code': 'CO',
        'x-api-key': 'secret',
        host: 'localhost',
      }),
    ).toEqual({ 'x-country-code': 'CO' });
  });

  it.each(['order-2026-0001', 'a'.repeat(8), 'A.b:c_d-e1', 'x'.repeat(128)])(
    'accepts the Idempotency-Key %j',
    (key) => {
      expect(idempotencyKeySchema.safeParse(key).success).toBe(true);
    },
  );

  it.each(['short', 'x'.repeat(129), 'has space 12', 'ñandú-12345', ''])(
    'rejects the Idempotency-Key %j',
    (key) => {
      expect(idempotencyKeySchema.safeParse(key).success).toBe(false);
    },
  );

  it('treats a missing Idempotency-Key as absent', () => {
    expect(idempotencyKeySchema.parse(undefined)).toBeUndefined();
  });

  it('parses a 24-hex id into an ObjectId and rejects anything else', () => {
    const id = '665f1c2a9b1e8a3d4c5b6a79';

    expect(validationIdSchema.parse(id)).toEqual(new ObjectId(id));
    for (const bad of [
      '',
      'abc',
      id.slice(1),
      `${id}0`,
      id.replace('6', 'z'),
    ]) {
      expect(validationIdSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('ZodValidationPipe', () => {
  it('returns the parsed value and throws the ZodError otherwise', () => {
    const pipe = new ZodValidationPipe(idempotencyKeySchema);

    expect(pipe.transform('order-2026-0001')).toBe('order-2026-0001');
    expect(() => pipe.transform('no')).toThrow();
  });
});

describe('toValidationResponse', () => {
  it('copies only the public fields', () => {
    const _id = new ObjectId();
    const record = {
      _id,
      name: 'Ana',
      documentNumber: '1',
      countryCode: 'CO',
      enrichment: { code: 'CO' },
      createdAt: new Date(0),
      idempotencyKey: 'order-2026-0001',
      requestFingerprint: 'v1:abc',
      eventId: 'leak',
    } as unknown as Parameters<typeof toValidationResponse>[0];

    const response = toValidationResponse(record);

    expect(Object.keys(response).sort()).toEqual(
      [
        'countryCode',
        'createdAt',
        'documentNumber',
        'enrichment',
        'id',
        'name',
      ].sort(),
    );
    expect(response.id).toBe(_id.toHexString());
  });
});

describe('repositories', () => {
  const createIndexes = vi.fn().mockResolvedValue([]);
  const mongo = {
    db: { collection: vi.fn(() => ({ createIndexes })) },
  } as unknown as MongoService;

  beforeEach(() => {
    createIndexes.mockClear();
  });

  it('declares the partial unique idempotency index', async () => {
    await new ValidationRepository(mongo).ensureIndexes();

    expect(createIndexes).toHaveBeenCalledWith([
      {
        key: { idempotencyKey: 1 },
        name: IDEMPOTENCY_KEY_INDEX,
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      },
    ]);
  });

  it('declares the unique event id and the pending-events index', async () => {
    await new OutboxRepository(mongo).ensureIndexes();

    expect(createIndexes).toHaveBeenCalledWith([
      { key: { eventId: 1 }, name: 'eventId_unique', unique: true },
      { key: { status: 1, nextAttemptAt: 1 }, name: 'status_nextAttemptAt' },
    ]);
  });
});

describe('validation record typing', () => {
  it('keeps idempotency metadata optional', () => {
    const record: IValidation = {
      name: 'a',
      documentNumber: '1',
      countryCode: 'CO',
      enrichment: {
        source: 'rest-countries',
        code: 'CO',
        commonName: 'Colombia',
        capitals: [],
        languages: [],
        currencies: [],
        enrichedAt: new Date(),
      },
      createdAt: new Date(),
    };

    expect(record.idempotencyKey).toBeUndefined();
  });
});
