import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MongoError, MongoServerError, ObjectId } from 'mongodb';
import { makeAppConfig } from '../../../test/support/app-config.js';
import type { OutboxRepository } from '../../audit/repositories/outbox.repository.js';
import type { AuditPublisher } from '../../audit/services/audit-publisher.service.js';
import type { CountriesService } from '../../countries/services/countries.service.js';
import type { RequestContextService } from '../../common/services/request-context.service.js';
import type { MongoService } from '../../database/mongo/mongo.service.js';
import type { ICountryEnrichment } from '../../enrichment/interfaces/country-enrichment.interface.js';
import type { RestCountriesService } from '../../enrichment/services/rest-countries.service.js';
import type { IValidation } from '../interfaces/validation.interface.js';
import type { ValidationRepository } from '../repositories/validation.repository.js';
import { computeRequestFingerprint } from '../utils/request-fingerprint.util.js';
import {
  IDEMPOTENCY_CONFLICT_MESSAGE,
  MAX_PERSISTENCE_ATTEMPTS,
  OUTCOME_UNCONFIRMED_MESSAGE,
  OUTCOME_UNCONFIRMED_NO_KEY_MESSAGE,
  ValidationsService,
} from './validations.service.js';

const SECRET = 's'.repeat(40);
const KEY = 'order-2026-0001';
const INPUT = { countryCode: 'CO', name: 'Ana Perez', documentNumber: '123' };
const FINGERPRINT = computeRequestFingerprint(SECRET, INPUT);
const ENRICHMENT = { code: 'CO' } as unknown as ICountryEnrichment;

function duplicateKey(field: string): MongoServerError {
  return new MongoServerError({
    message: 'E11000 duplicate key error',
    code: 11000,
    keyPattern: { [field]: 1 },
  });
}

function transient(): MongoError {
  const error = new MongoError('write conflict');
  error.addErrorLabel('TransientTransactionError');
  return error;
}

/**
 * Transaction double that runs the work (so the documents are written) and
 * then fails, as when the commit outcome is unknown or the commit collides.
 */
function failAfterWork(error: Error) {
  return async (work: (s: unknown) => Promise<unknown>): Promise<unknown> => {
    await work({});
    throw error;
  };
}

function stored(
  overrides: Partial<IValidation> = {},
): IValidation & { _id: ObjectId } {
  return {
    _id: new ObjectId(),
    name: INPUT.name,
    documentNumber: INPUT.documentNumber,
    countryCode: 'CO',
    enrichment: ENRICHMENT,
    createdAt: new Date(),
    idempotencyKey: KEY,
    requestFingerprint: FINGERPRINT,
    ...overrides,
  };
}

function setup() {
  const session = { id: 'session' };
  const mongo = {
    withTransaction: vi.fn(async (work: (s: unknown) => Promise<unknown>) =>
      work(session),
    ),
  };
  const validations = {
    create: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(null),
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
  };
  const outbox = { create: vi.fn().mockResolvedValue(undefined) };
  const countries = {
    assertEnabled: vi.fn().mockResolvedValue({ code: 'CO' }),
  };
  const restCountries = { enrich: vi.fn().mockResolvedValue(ENRICHMENT) };
  const auditPublisher = {
    publishInline: vi.fn().mockResolvedValue(undefined),
  };
  const requestContext = { get: vi.fn().mockReturnValue(undefined) };
  const service = new ValidationsService(
    mongo as unknown as MongoService,
    validations as unknown as ValidationRepository,
    outbox as unknown as OutboxRepository,
    countries as unknown as CountriesService,
    restCountries as unknown as RestCountriesService,
    auditPublisher as unknown as AuditPublisher,
    requestContext as unknown as RequestContextService,
    makeAppConfig({ IDEMPOTENCY_HASH_SECRET: SECRET }),
  );
  return {
    auditPublisher,
    requestContext,
    service,
    mongo,
    validations,
    outbox,
    countries,
    restCountries,
    session,
  };
}

describe('ValidationsService', () => {
  it('requires IDEMPOTENCY_HASH_SECRET without revealing values', () => {
    expect(
      () =>
        new ValidationsService(
          {} as MongoService,
          {} as ValidationRepository,
          {} as OutboxRepository,
          {} as CountriesService,
          {} as RestCountriesService,
          {} as AuditPublisher,
          {} as RequestContextService,
          makeAppConfig(),
        ),
    ).toThrow('IDEMPOTENCY_HASH_SECRET');
  });

  describe('create without Idempotency-Key', () => {
    it('validates the country, enriches once and writes both documents in one transaction session', async () => {
      const {
        service,
        mongo,
        validations,
        outbox,
        countries,
        restCountries,
        session,
      } = setup();

      const result = await service.create(INPUT);

      expect(countries.assertEnabled).toHaveBeenCalledWith('CO');
      expect(restCountries.enrich).toHaveBeenCalledTimes(1);
      expect(mongo.withTransaction).toHaveBeenCalledTimes(1);
      expect(validations.findByIdempotencyKey).not.toHaveBeenCalled();
      const [validationDoc, validationSession] = validations.create.mock
        .calls[0] as [Record<string, unknown>, unknown];
      const [eventDoc, outboxSession] = outbox.create.mock.calls[0] as [
        Record<string, unknown>,
        unknown,
      ];
      expect(validationSession).toBe(session);
      expect(outboxSession).toBe(session);
      expect(result.id).toBe((validationDoc['_id'] as ObjectId).toHexString());
      expect(eventDoc).toMatchObject({
        validationId: validationDoc['_id'],
        eventType: 'VALIDATION_CREATED',
        status: 'PENDING',
        attempts: 0,
        documentNumber: '123',
        countryCode: 'CO',
        occurredAt: validationDoc['createdAt'],
        nextAttemptAt: validationDoc['createdAt'],
      });
      expect(validationDoc).not.toHaveProperty('idempotencyKey');
      expect(validationDoc).not.toHaveProperty('requestFingerprint');
    });

    it('does not open a transaction when the country is not enabled', async () => {
      const { service, mongo, countries, restCountries } = setup();
      countries.assertEnabled.mockRejectedValue(new Error('unsupported'));

      await expect(service.create(INPUT)).rejects.toThrow('unsupported');
      expect(restCountries.enrich).not.toHaveBeenCalled();
      expect(mongo.withTransaction).not.toHaveBeenCalled();
    });

    it('does not open a transaction when enrichment fails', async () => {
      const { service, mongo, restCountries } = setup();
      restCountries.enrich.mockRejectedValue(new BadGatewayException());

      await expect(service.create(INPUT)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(mongo.withTransaction).not.toHaveBeenCalled();
    });

    it('propagates persistence errors untouched, with a single attempt', async () => {
      const { service, mongo } = setup();
      const failure = duplicateKey('idempotencyKey');
      mongo.withTransaction.mockRejectedValue(failure);

      await expect(service.create(INPUT)).rejects.toBe(failure);
      expect(mongo.withTransaction).toHaveBeenCalledTimes(1);
    });

    it('accepts its own record after an unknown commit result', async () => {
      const { service, mongo, validations } = setup();
      const unknown = new MongoError('commit time limit');
      unknown.addErrorLabel('UnknownTransactionCommitResult');
      mongo.withTransaction.mockRejectedValueOnce(unknown);
      validations.findById.mockImplementation((id: ObjectId) =>
        Promise.resolve(stored({ _id: id } as Partial<IValidation>)),
      );

      const result = await service.create(INPUT);

      expect(result.id).toMatch(/^[0-9a-f]{24}$/);
      expect(mongo.withTransaction).toHaveBeenCalledTimes(1);
      expect(validations.findById).toHaveBeenCalledTimes(1);
    });

    it('answers 503 when an unknown commit result cannot be confirmed', async () => {
      const { service, mongo, validations } = setup();
      const unknown = new MongoError('commit time limit');
      unknown.addErrorLabel('UnknownTransactionCommitResult');
      mongo.withTransaction.mockRejectedValueOnce(unknown);

      const error: unknown = await service
        .create(INPUT)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).message).toBe(
        OUTCOME_UNCONFIRMED_NO_KEY_MESSAGE,
      );
      expect(validations.findById).toHaveBeenCalledTimes(1);
      expect(mongo.withTransaction).toHaveBeenCalledTimes(1);
    });

    it('does not reconcile other errors (no lookup, no 503)', async () => {
      const { service, mongo, validations } = setup();
      const transientOnly = transient();
      mongo.withTransaction.mockRejectedValueOnce(transientOnly);

      await expect(service.create(INPUT)).rejects.toBe(transientOnly);
      expect(validations.findById).not.toHaveBeenCalled();
    });

    it('never runs the provider call inside the transaction', async () => {
      const { service, mongo, restCountries } = setup();
      let enrichedDuringTransaction = false;
      mongo.withTransaction.mockImplementation(async (work) => {
        enrichedDuringTransaction =
          restCountries.enrich.mock.calls.length === 0;
        return work({});
      });

      await service.create(INPUT);

      expect(enrichedDuringTransaction).toBe(false);
    });
  });

  describe('create with Idempotency-Key', () => {
    const input = { ...INPUT, idempotencyKey: KEY };

    it('stores the key and the HMAC fingerprint, never the body hash in clear', async () => {
      const { service, validations } = setup();

      await service.create(input);

      const [doc] = validations.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(doc['idempotencyKey']).toBe(KEY);
      expect(doc['requestFingerprint']).toBe(FINGERPRINT);
    });

    it('replays an equivalent request before country validation and enrichment', async () => {
      const { service, validations, countries, restCountries, mongo } = setup();
      const existing = stored();
      validations.findByIdempotencyKey.mockResolvedValue(existing);

      const result = await service.create({
        ...input,
        name: '  Ana Perez ',
      });

      expect(result).toEqual({ id: existing._id.toHexString() });
      expect(countries.assertEnabled).not.toHaveBeenCalled();
      expect(restCountries.enrich).not.toHaveBeenCalled();
      expect(mongo.withTransaction).not.toHaveBeenCalled();
    });

    it('answers 409 when the stored fingerprint differs', async () => {
      const { service, validations, mongo } = setup();
      validations.findByIdempotencyKey.mockResolvedValue(
        stored({ requestFingerprint: 'v1:other' }),
      );

      const error: unknown = await service
        .create(input)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        IDEMPOTENCY_CONFLICT_MESSAGE,
      );
      expect(mongo.withTransaction).not.toHaveBeenCalled();
    });

    it('resolves an idempotency-index collision as a replay of the winner', async () => {
      const { service, validations, mongo, restCountries } = setup();
      const winner = stored();
      mongo.withTransaction.mockRejectedValueOnce(
        duplicateKey('idempotencyKey'),
      );
      validations.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValue(winner);

      const result = await service.create(input);

      expect(result).toEqual({ id: winner._id.toHexString() });
      expect(mongo.withTransaction).toHaveBeenCalledTimes(1);
      expect(restCountries.enrich).toHaveBeenCalledTimes(1);
    });

    it('answers 409 when the collision winner has different content', async () => {
      const { service, validations, mongo } = setup();
      mongo.withTransaction.mockRejectedValueOnce(
        duplicateKey('idempotencyKey'),
      );
      validations.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValue(stored({ requestFingerprint: 'v1:other' }));

      await expect(service.create(input)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('retries a surviving transient error with the same documents and a single provider call', async () => {
      const { service, mongo, validations, outbox, restCountries } = setup();
      mongo.withTransaction
        .mockRejectedValueOnce(transient())
        .mockRejectedValueOnce(transient());

      const result = await service.create(input);

      expect(mongo.withTransaction).toHaveBeenCalledTimes(3);
      expect(restCountries.enrich).toHaveBeenCalledTimes(1);
      const ids = new Set(
        validations.create.mock.calls.map(([doc]) =>
          (doc as { _id: ObjectId })._id.toHexString(),
        ),
      );
      expect([...ids]).toEqual([result.id]);
      const eventIds = new Set(
        outbox.create.mock.calls.map(
          ([doc]) => (doc as { eventId: string }).eventId,
        ),
      );
      expect(eventIds.size).toBe(1);
    });

    it('replays the winner after a transient error when it is visible', async () => {
      const { service, mongo, validations } = setup();
      const winner = stored();
      mongo.withTransaction.mockRejectedValueOnce(transient());
      validations.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValue(winner);

      await expect(service.create(input)).resolves.toEqual({
        id: winner._id.toHexString(),
      });
      expect(mongo.withTransaction).toHaveBeenCalledTimes(1);
    });

    it('accepts its own record after an unknown commit result', async () => {
      const { service, mongo, validations } = setup();
      const unknown = new MongoError('unknown commit');
      unknown.addErrorLabel('UnknownTransactionCommitResult');
      mongo.withTransaction.mockRejectedValueOnce(unknown);
      validations.findById.mockImplementation((id: ObjectId) =>
        Promise.resolve(stored({ _id: id } as Partial<IValidation>)),
      );

      const result = await service.create(input);

      expect(mongo.withTransaction).toHaveBeenCalledTimes(1);
      expect(validations.findById).toHaveBeenCalledTimes(1);
      expect(result.id).toMatch(/^[0-9a-f]{24}$/);
    });

    it('accepts its own record when a retry collides with its own _id after an unknown commit', async () => {
      const { service, mongo, validations, outbox, auditPublisher } = setup();
      const unknown = new MongoError('unknown commit');
      unknown.addErrorLabel('UnknownTransactionCommitResult');
      // Attempt 1: unknown outcome, not visible yet. Attempt 2: the first
      // commit landed meanwhile, so the retry hits its own primary key.
      mongo.withTransaction
        .mockImplementationOnce(failAfterWork(unknown))
        .mockImplementationOnce(failAfterWork(duplicateKey('_id')));
      validations.findById
        .mockResolvedValueOnce(null)
        .mockImplementation((id: ObjectId) =>
          Promise.resolve(stored({ _id: id } as Partial<IValidation>)),
        );

      const result = await service.create(input);

      const [firstDoc] = validations.create.mock.calls[0] as [
        { _id: ObjectId },
      ];
      const [event] = outbox.create.mock.calls[0] as [{ eventId: string }];
      expect(result).toEqual({ id: firstDoc._id.toHexString() });
      expect(mongo.withTransaction).toHaveBeenCalledTimes(2);
      expect(validations.findById).toHaveBeenCalledTimes(2);
      expect(auditPublisher.publishInline).toHaveBeenCalledTimes(1);
      expect(auditPublisher.publishInline).toHaveBeenCalledWith(
        event.eventId,
        undefined,
      );
    });

    it.each([
      ['the record is not found', null],
      ['the record has another fingerprint', 'v1:other'],
    ])(
      'rethrows a duplicate _id untouched when %s',
      async (_label, fingerprint) => {
        const { service, mongo, validations, auditPublisher } = setup();
        const failure = duplicateKey('_id');
        mongo.withTransaction.mockRejectedValue(failure);
        validations.findById.mockImplementation((id: ObjectId) =>
          Promise.resolve(
            fingerprint === null
              ? null
              : stored({
                  _id: id,
                  requestFingerprint: fingerprint,
                } as Partial<IValidation>),
          ),
        );

        await expect(service.create(input)).rejects.toBe(failure);
        expect(mongo.withTransaction).toHaveBeenCalledTimes(1);
        // Only the initial lookup happened: no winner was read.
        expect(validations.findByIdempotencyKey).toHaveBeenCalledTimes(1);
        expect(auditPublisher.publishInline).not.toHaveBeenCalled();
      },
    );

    it('answers 503 when the winner never becomes visible', async () => {
      const { service, mongo, validations } = setup();
      mongo.withTransaction.mockRejectedValue(duplicateKey('idempotencyKey'));
      validations.findByIdempotencyKey.mockResolvedValue(null);

      const error: unknown = await service
        .create(input)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).message).toBe(
        OUTCOME_UNCONFIRMED_MESSAGE,
      );
      expect(mongo.withTransaction).toHaveBeenCalledTimes(
        MAX_PERSISTENCE_ATTEMPTS,
      );
    });

    it('answers 503 when transient errors exhaust the attempts', async () => {
      const { service, mongo, restCountries } = setup();
      mongo.withTransaction.mockRejectedValue(transient());

      await expect(service.create(input)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(mongo.withTransaction).toHaveBeenCalledTimes(
        MAX_PERSISTENCE_ATTEMPTS,
      );
      expect(restCountries.enrich).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['E11000 on another index', duplicateKey('eventId')],
      [
        'an unrelated server error',
        new MongoServerError({ message: 'not authorized', code: 13 }),
      ],
      ['a plain error', new Error('boom')],
    ])(
      'rethrows %s untouched and never turns it into a replay',
      async (_label, failure) => {
        const { service, mongo, validations } = setup();
        validations.findByIdempotencyKey.mockResolvedValue(stored());
        validations.findByIdempotencyKey.mockResolvedValueOnce(null);
        mongo.withTransaction.mockRejectedValue(failure);

        await expect(service.create(input)).rejects.toBe(failure);
        expect(mongo.withTransaction).toHaveBeenCalledTimes(1);
        // Only the initial lookup happened: the winner was never read.
        expect(validations.findByIdempotencyKey).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('inline audit publication', () => {
    const unknownCommit = (): MongoError => {
      const error = new MongoError('commit time limit');
      error.addErrorLabel('UnknownTransactionCommitResult');
      return error;
    };

    it('publishes the created event only after the transaction resolved', async () => {
      const { service, mongo, outbox, auditPublisher } = setup();
      const order: string[] = [];
      mongo.withTransaction.mockImplementation(async (work) => {
        const result = await work({});
        order.push('committed');
        return result;
      });
      auditPublisher.publishInline.mockImplementation(() => {
        order.push('published');
        return Promise.resolve();
      });

      const result = await service.create(INPUT);

      const [event] = outbox.create.mock.calls[0] as [{ eventId: string }];
      expect(auditPublisher.publishInline).toHaveBeenCalledExactlyOnceWith(
        event.eventId,
        undefined,
      );
      expect(order).toEqual(['committed', 'published']);
      expect(result.id).toMatch(/^[0-9a-f]{24}$/);
    });

    it.each([
      ['rejects', () => Promise.reject(new Error('boom'))],
      [
        'throws synchronously',
        () => {
          throw new Error('boom');
        },
      ],
    ])(
      'keeps the 201 outcome when the publisher %s',
      async (_label, behaviour) => {
        const { service, auditPublisher } = setup();
        auditPublisher.publishInline.mockImplementation(behaviour);

        const result = await service.create(INPUT);

        expect(result.id).toMatch(/^[0-9a-f]{24}$/);
      },
    );

    it('keeps the outcome with an Idempotency-Key when the publisher fails', async () => {
      const { service, auditPublisher } = setup();
      auditPublisher.publishInline.mockRejectedValue(new Error('boom'));

      const result = await service.create({ ...INPUT, idempotencyKey: KEY });

      expect(result.id).toMatch(/^[0-9a-f]{24}$/);
    });

    it('publishes after an unknown commit result proven by the lookup (no key)', async () => {
      const { service, mongo, validations, auditPublisher } = setup();
      mongo.withTransaction.mockRejectedValueOnce(unknownCommit());
      validations.findById.mockImplementation((id: ObjectId) =>
        Promise.resolve(stored({ _id: id } as Partial<IValidation>)),
      );

      await service.create(INPUT);

      expect(auditPublisher.publishInline).toHaveBeenCalledTimes(1);
    });

    it('publishes after an unknown commit result proven by the lookup (with key)', async () => {
      const { service, mongo, validations, auditPublisher } = setup();
      mongo.withTransaction.mockRejectedValueOnce(unknownCommit());
      validations.findById.mockImplementation((id: ObjectId) =>
        Promise.resolve(stored({ _id: id } as Partial<IValidation>)),
      );

      await service.create({ ...INPUT, idempotencyKey: KEY });

      expect(auditPublisher.publishInline).toHaveBeenCalledTimes(1);
    });

    it('publishes when the idempotency winner is its own earlier attempt', async () => {
      const { service, mongo, validations, outbox, auditPublisher } = setup();
      mongo.withTransaction.mockImplementationOnce(
        failAfterWork(unknownCommit()),
      );
      // The own record is not found by id yet, but becomes visible through
      // the idempotency key while the winner is read.
      validations.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockImplementation(() => {
          const [doc] = validations.create.mock.calls[0] as [{ _id: ObjectId }];
          return Promise.resolve(
            stored({ _id: doc._id } as Partial<IValidation>),
          );
        });

      const result = await service.create({ ...INPUT, idempotencyKey: KEY });

      const [doc] = validations.create.mock.calls[0] as [{ _id: ObjectId }];
      const [event] = outbox.create.mock.calls[0] as [{ eventId: string }];
      expect(result).toEqual({ id: doc._id.toHexString() });
      expect(mongo.withTransaction).toHaveBeenCalledTimes(1);
      expect(auditPublisher.publishInline).toHaveBeenCalledTimes(1);
      expect(auditPublisher.publishInline).toHaveBeenCalledWith(
        event.eventId,
        undefined,
      );
    });

    it('does not publish when the idempotency winner is another request', async () => {
      const { service, mongo, validations, auditPublisher } = setup();
      mongo.withTransaction.mockRejectedValueOnce(
        duplicateKey('idempotencyKey'),
      );
      validations.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValue(stored());

      await service.create({ ...INPUT, idempotencyKey: KEY });

      expect(auditPublisher.publishInline).not.toHaveBeenCalled();
    });

    it('does not publish when the commit cannot be confirmed', async () => {
      const { service, mongo, auditPublisher } = setup();
      mongo.withTransaction.mockRejectedValueOnce(unknownCommit());

      await expect(service.create(INPUT)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(auditPublisher.publishInline).not.toHaveBeenCalled();
    });

    it('does not publish when the transaction fails', async () => {
      const { service, mongo, auditPublisher } = setup();
      mongo.withTransaction.mockRejectedValue(new Error('rollback'));

      await expect(service.create(INPUT)).rejects.toThrow('rollback');
      expect(auditPublisher.publishInline).not.toHaveBeenCalled();
    });

    it('passes the request start time so the publisher can bound its budget', async () => {
      const { service, requestContext, auditPublisher } = setup();
      const startedAt = new Date(Date.now() - 12000);
      requestContext.get.mockReturnValue({ startedAt });

      await service.create(INPUT);

      expect(auditPublisher.publishInline).toHaveBeenCalledWith(
        expect.any(String),
        startedAt,
      );
    });

    it('does not publish for an idempotent replay', async () => {
      const { service, validations, auditPublisher } = setup();
      validations.findByIdempotencyKey.mockResolvedValue(stored());

      await service.create({ ...INPUT, idempotencyKey: KEY });

      expect(auditPublisher.publishInline).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('maps the record through the allow-list', async () => {
      const { service, validations } = setup();
      const record = stored();
      validations.findById.mockResolvedValue(record);

      const result = await service.findById(record._id);

      expect(result).toEqual({
        id: record._id.toHexString(),
        name: INPUT.name,
        documentNumber: INPUT.documentNumber,
        countryCode: 'CO',
        enrichment: ENRICHMENT,
        createdAt: record.createdAt,
      });
      expect(result).not.toHaveProperty('idempotencyKey');
      expect(result).not.toHaveProperty('requestFingerprint');
    });

    it('throws NotFound when the record does not exist', async () => {
      const { service } = setup();

      await expect(service.findById(new ObjectId())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
