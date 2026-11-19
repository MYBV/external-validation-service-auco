import { type INestApplication, Logger } from '@nestjs/common';
import { type ClientSession, MongoError, ObjectId } from 'mongodb';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { IOutboxEvent } from '../../src/audit/interfaces/outbox-event.interface.js';
import { CountriesService } from '../../src/countries/services/countries.service.js';
import { initializeMongo } from '../../src/database/init/initialize-mongo.js';
import { isDuplicateKeyError } from '../../src/database/mongo/mongo-errors.js';
import type { MongoService } from '../../src/database/mongo/mongo.service.js';
import type { IValidation } from '../../src/validations/interfaces/validation.interface.js';
import {
  createTestApp,
  type ITestAppClasses,
  TEST_API_KEY,
  TEST_IDEMPOTENCY_SECRET,
} from '../support/create-test-app.js';
import {
  dropTestDatabase,
  loadIntegrationEnv,
} from '../support/integration-env.js';
import { makeRestCountriesFake } from '../support/validations-fakes.js';

const NAME = 'Maria Fernanda Lopez';
const DOCUMENT = '1020304050';
const BODY = { name: NAME, documentNumber: DOCUMENT };

describe('Validations (real MongoDB replica set)', () => {
  const { config } = loadIntegrationEnv();
  const restCountries = makeRestCountriesFake();
  let app: INestApplication<App>;
  let classes: ITestAppClasses;
  let mongo: MongoService;
  let validationRepository: InstanceType<
    ITestAppClasses['ValidationRepository']
  >;
  let outboxRepository: InstanceType<ITestAppClasses['OutboxRepository']>;

  const validationsCollection = () =>
    mongo.db.collection<IValidation>('validations');
  const outboxCollection = () =>
    mongo.db.collection<IOutboxEvent>('audit_outbox');

  const post = (body: object = BODY, key?: string, country = 'CO') => {
    const req = request(app.getHttpServer())
      .post('/validations')
      .set('x-api-key', TEST_API_KEY)
      .set('x-country-code', country);
    return (key === undefined ? req : req.set('Idempotency-Key', key)).send(
      body,
    );
  };
  const idOf = (response: request.Response): string =>
    (response.body as { data: { id: string } }).data.id;

  beforeAll(async () => {
    app = await createTestApp(
      {
        MONGO_URI: config.mongo.uri ?? '',
        MONGO_DB_NAME: config.mongo.dbName,
        REQUEST_TIMEOUT_MS: '20000',
      },
      {
        realMongo: true,
        customize: (builder, appClasses) => {
          classes = appClasses;
          builder
            .overrideProvider(appClasses.RestCountriesService)
            .useValue(restCountries);
        },
      },
    );
    mongo = app.get(classes.MongoService);
    validationRepository = app.get(classes.ValidationRepository);
    outboxRepository = app.get(classes.OutboxRepository);
    const countryRepository = app.get(classes.CountryRepository);
    await initializeMongo(mongo, [
      countryRepository,
      validationRepository,
      outboxRepository,
    ]);
    await new CountriesService(countryRepository).seed();
  });

  afterAll(async () => {
    try {
      await dropTestDatabase(mongo);
    } finally {
      await app.close();
    }
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    restCountries.enrich.mockClear();
    await validationsCollection().deleteMany({});
    await outboxCollection().deleteMany({});
  });

  /** Every event has its validation and every validation has exactly one event. */
  const expectConsistentStores = async (): Promise<void> => {
    const validations = await validationsCollection().find().toArray();
    const events = await outboxCollection().find().toArray();
    expect(events).toHaveLength(validations.length);
    const validationIds = new Set(validations.map((v) => v._id.toHexString()));
    const eventTargets = events.map((event) =>
      event.validationId.toHexString(),
    );
    for (const target of eventTargets) {
      expect(validationIds.has(target)).toBe(true);
    }
    expect(new Set(eventTargets).size).toBe(events.length);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(
      events.length,
    );
  };

  describe('indexes', () => {
    it('creates the idempotency and outbox indexes, idempotently', async () => {
      await initializeMongo(mongo, [validationRepository, outboxRepository]);
      await initializeMongo(mongo, [validationRepository, outboxRepository]);

      const validationIndexes = await validationsCollection().indexes();
      const idempotency = validationIndexes.filter(
        (index) => index.name === 'idempotencyKey_unique',
      );
      expect(idempotency).toHaveLength(1);
      expect(idempotency[0]).toMatchObject({
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      });

      const outboxIndexes = await outboxCollection().indexes();
      expect(
        outboxIndexes.filter((index) => index.name === 'eventId_unique'),
      ).toHaveLength(1);
      expect(
        outboxIndexes.filter((index) => index.name === 'status_nextAttemptAt'),
      ).toHaveLength(1);
    });

    it('rejects a duplicate idempotency key (E11000) but allows many records without one', async () => {
      const base = {
        name: 'a',
        documentNumber: '1',
        countryCode: 'CO',
        enrichment: await restCountries.enrich('CO'),
        createdAt: new Date(),
      };
      await validationRepository.create({ ...base });
      await validationRepository.create({ ...base });
      await validationRepository.create({
        ...base,
        idempotencyKey: 'dup-key-001',
      });

      const error: unknown = await validationRepository
        .create({ ...base, idempotencyKey: 'dup-key-001' })
        .catch((caught: unknown) => caught);

      expect(isDuplicateKeyError(error)).toBe(true);
      expect(await validationsCollection().countDocuments()).toBe(3);
    });
  });

  describe('POST /validations atomicity', () => {
    it('stores the validation and a PENDING outbox event, then serves it by GET', async () => {
      const response = await post().expect(201);
      const id = idOf(response);

      const validations = await validationsCollection().find().toArray();
      const events = await outboxCollection().find().toArray();
      expect(validations).toHaveLength(1);
      expect(events).toHaveLength(1);
      expect(validations[0]?._id.toHexString()).toBe(id);
      expect(events[0]).toMatchObject({
        eventType: 'VALIDATION_CREATED',
        status: 'PENDING',
        attempts: 0,
        documentNumber: DOCUMENT,
        countryCode: 'CO',
      });
      expect(events[0]?.validationId.toHexString()).toBe(id);
      expect(events[0]?.occurredAt).toEqual(validations[0]?.createdAt);
      expect(events[0]?.nextAttemptAt).toEqual(events[0]?.occurredAt);

      const got = await request(app.getHttpServer())
        .get(`/validations/${id}`)
        .set('x-api-key', TEST_API_KEY)
        .expect(200);
      const text = JSON.stringify(got.body);
      expect(got.body).toMatchObject({
        data: { id, name: NAME, documentNumber: DOCUMENT, countryCode: 'CO' },
      });
      expect(text).not.toContain('eventId');
      expect(text).not.toContain('PENDING');
      expect(text).not.toContain('requestFingerprint');
      await expectConsistentStores();
    });

    it('answers 404 for an id that does not exist', async () => {
      await request(app.getHttpServer())
        .get('/validations/665f1c2a9b1e8a3d4c5b6a79')
        .set('x-api-key', TEST_API_KEY)
        .expect(404);
    });

    it('writes both documents with the same ClientSession inside an active transaction', async () => {
      const sessions: ClientSession[] = [];
      const activeAtEnd: boolean[] = [];
      const original = mongo.withTransaction.bind(mongo);
      vi.spyOn(mongo, 'withTransaction').mockImplementation((work) =>
        original(async (session) => {
          sessions.push(session);
          const result = await work(session);
          activeAtEnd.push(session.inTransaction());
          return result;
        }),
      );
      const validationSpy = vi.spyOn(validationRepository, 'create');
      const outboxSpy = vi.spyOn(outboxRepository, 'create');

      await post().expect(201);

      expect(sessions).toHaveLength(1);
      expect(activeAtEnd).toEqual([true]);
      expect(validationSpy).toHaveBeenCalledTimes(1);
      expect(outboxSpy).toHaveBeenCalledTimes(1);
      expect(validationSpy.mock.calls[0]?.[1]).toBe(sessions[0]);
      expect(outboxSpy.mock.calls[0]?.[1]).toBe(sessions[0]);
      await expectConsistentStores();
    });

    it('does not expose the validation before the transaction commits', async () => {
      let visibleBeforeCommit: number | undefined;
      const original = outboxRepository.create.bind(outboxRepository);
      vi.spyOn(outboxRepository, 'create').mockImplementation(
        async (document, session) => {
          visibleBeforeCommit = await validationsCollection().countDocuments();
          return original(document, session);
        },
      );

      await post().expect(201);

      expect(visibleBeforeCommit).toBe(0);
      expect(await validationsCollection().countDocuments()).toBe(1);
    });

    it('rolls back the validation when the outbox insert fails', async () => {
      vi.spyOn(outboxRepository, 'create').mockRejectedValueOnce(
        new Error('outbox write failed'),
      );

      await post().expect(500);

      expect(await validationsCollection().countDocuments()).toBe(0);
      expect(await outboxCollection().countDocuments()).toBe(0);
    });

    it('leaves no outbox event when the validation insert fails', async () => {
      vi.spyOn(validationRepository, 'create').mockRejectedValueOnce(
        new Error('validation write failed'),
      );

      await post().expect(500);

      expect(await validationsCollection().countDocuments()).toBe(0);
      expect(await outboxCollection().countDocuments()).toBe(0);
    });

    it('rolls back both writes on a real unique violation of the outbox', async () => {
      // Pre-existing event with the id the failing request will try to reuse.
      const original = outboxRepository.create.bind(outboxRepository);
      await outboxCollection().insertOne({
        eventId: 'fixed-event-id',
        validationId: await validationRepository.create({
          name: 'seed',
          documentNumber: '0',
          countryCode: 'CO',
          enrichment: await restCountries.enrich('CO'),
          createdAt: new Date(),
        }),
        eventType: 'VALIDATION_CREATED',
        documentNumber: '0',
        countryCode: 'CO',
        occurredAt: new Date(),
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
      });
      vi.spyOn(outboxRepository, 'create').mockImplementation(
        (document, session) =>
          original({ ...document, eventId: 'fixed-event-id' }, session),
      );

      await post().expect(500);

      expect(await validationsCollection().countDocuments()).toBe(1);
      expect(await outboxCollection().countDocuments()).toBe(1);
    });

    it('does not persist anything when enrichment fails', async () => {
      restCountries.enrich.mockRejectedValueOnce(new Error('provider down'));

      await post().expect(500);

      expect(await validationsCollection().countDocuments()).toBe(0);
      expect(await outboxCollection().countDocuments()).toBe(0);
    });

    it('rejects unsupported countries before touching the database', async () => {
      const countries = mongo.db.collection('countries');
      await countries.updateOne({ code: 'MX' }, { $set: { enabled: false } });
      try {
        await post(BODY, undefined, 'ZZ').expect(400);
        await post(BODY, undefined, 'MX').expect(400);
      } finally {
        await countries.updateOne({ code: 'MX' }, { $set: { enabled: true } });
      }

      expect(await validationsCollection().countDocuments()).toBe(0);
      expect(restCountries.enrich).not.toHaveBeenCalled();
    });
  });

  describe('Idempotency-Key', () => {
    it('replays an equivalent request: same id, no new documents, one provider call', async () => {
      const key = 'order-2026-0001';
      const first = await post(BODY, key).expect(201);
      const replay = await post(
        { name: `  ${NAME} `, documentNumber: ` ${DOCUMENT}` },
        key,
      ).expect(201);

      expect(idOf(replay)).toBe(idOf(first));
      expect(await validationsCollection().countDocuments()).toBe(1);
      expect(await outboxCollection().countDocuments()).toBe(1);
      expect(restCountries.enrich).toHaveBeenCalledTimes(1);
      await expectConsistentStores();
    });

    it('answers 409 for the same key with different content and writes nothing', async () => {
      const key = 'order-2026-0002';
      await post(BODY, key).expect(201);

      await post({ ...BODY, documentNumber: '999' }, key).expect(409);
      await post(BODY, key, 'CO').expect(201);

      expect(await validationsCollection().countDocuments()).toBe(1);
      expect(await outboxCollection().countDocuments()).toBe(1);
    });

    it('stores only the HMAC fingerprint, never the content', async () => {
      await post(BODY, 'order-2026-0003').expect(201);

      const stored = await validationsCollection().findOne({});
      expect(stored?.requestFingerprint).toMatch(/^v1:[0-9a-f]{64}$/);
      expect(stored?.requestFingerprint).not.toContain(DOCUMENT);
    });

    it('resolves 10 concurrent equal requests to one record and one event', async () => {
      const key = 'concurrent-same-001';

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => post(BODY, key)),
      );

      expect(responses.map((response) => response.status)).toEqual(
        Array.from({ length: 10 }, () => 201),
      );
      expect(new Set(responses.map(idOf)).size).toBe(1);
      expect(await validationsCollection().countDocuments()).toBe(1);
      expect(await outboxCollection().countDocuments()).toBe(1);
      await expectConsistentStores();
    });

    it('lets exactly one of several concurrent different requests win the key', async () => {
      const key = 'concurrent-diff-001';

      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          post({ name: NAME, documentNumber: `DOC-${index}` }, key),
        ),
      );

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
      expect(await validationsCollection().countDocuments()).toBe(1);
      expect(await outboxCollection().countDocuments()).toBe(1);
      await expectConsistentStores();
    });

    it('recovers from a transient transaction error without duplicates', async () => {
      const transient = new MongoError('simulated transient failure');
      transient.addErrorLabel('TransientTransactionError');
      vi.spyOn(outboxRepository, 'create').mockRejectedValueOnce(transient);

      const response = await post(BODY, 'transient-key-001').expect(201);

      expect(await validationsCollection().countDocuments()).toBe(1);
      expect(await outboxCollection().countDocuments()).toBe(1);
      expect(restCountries.enrich).toHaveBeenCalledTimes(1);
      expect(
        (await validationsCollection().findOne({}))?._id.toHexString(),
      ).toBe(idOf(response));
      await expectConsistentStores();
    });

    it('answers 503 and leaves nothing behind when the outcome cannot be confirmed', async () => {
      const transient = new MongoError('simulated transient failure');
      transient.addErrorLabel('TransientTransactionError');
      const withTransaction = vi
        .spyOn(mongo, 'withTransaction')
        .mockRejectedValue(transient);

      const response = await post(BODY, 'unconfirmed-key-01').expect(503);

      expect(withTransaction).toHaveBeenCalledTimes(3);
      expect(restCountries.enrich).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(response.body)).not.toContain('simulated');
      expect(await validationsCollection().countDocuments()).toBe(0);
      expect(await outboxCollection().countDocuments()).toBe(0);
    });
  });

  describe('commit time limit', () => {
    /** Wraps every session so its transactions use `override` options. */
    const forceTransactionOptions = (override: { maxCommitTimeMS: number }) => {
      const captured: Array<Record<string, unknown> | undefined> = [];
      const startSession = mongo.client.startSession.bind(mongo.client);
      vi.spyOn(mongo.client, 'startSession').mockImplementation((options) => {
        const session = startSession(options);
        const withTransaction = session.withTransaction.bind(session);
        vi.spyOn(session, 'withTransaction').mockImplementation(
          (work, transactionOptions) => {
            captured.push({ ...transactionOptions });
            return withTransaction(work, {
              ...transactionOptions,
              ...override,
            });
          },
        );
        return session;
      });
      return captured;
    };

    it('sends maxCommitTimeMS (MONGO_TIMEOUT_MS) with the majority options', async () => {
      const captured = forceTransactionOptions({
        maxCommitTimeMS: config.mongo.timeoutMs,
      });

      await post().expect(201);

      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({
        maxCommitTimeMS: config.mongo.timeoutMs,
        readConcern: { level: 'majority' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      });
    });

    it('does not imply a rollback: an expired commit may or may not be persisted', async () => {
      // A 1 ms commit limit expires almost always; the server then reports
      // MaxTimeMSExpired (code 50) with UnknownTransactionCommitResult.
      forceTransactionOptions({ maxCommitTimeMS: 1 });
      // findById is only used to reconcile an unknown commit result.
      const reconciliations = vi.spyOn(validationRepository, 'findById');
      const attempts = 25;
      const responses = [];
      for (let index = 0; index < attempts; index++) {
        responses.push(
          await post({ name: NAME, documentNumber: `DOC-${index}` }),
        );
      }

      const created = responses.filter((response) => response.status === 201);
      const unconfirmed = responses.filter(
        (response) => response.status === 503,
      );
      expect(reconciliations).toHaveBeenCalled();
      // Only the two honest outcomes exist: confirmed, or explicitly unconfirmed.
      expect(created.length + unconfirmed.length).toBe(attempts);
      // Every 201 is really persisted, with its event.
      for (const response of created) {
        const id = idOf(response);
        expect(
          await validationsCollection().countDocuments({
            _id: new ObjectId(id),
          }),
        ).toBe(1);
        expect(
          await outboxCollection().countDocuments({
            validationId: new ObjectId(id),
          }),
        ).toBe(1);
      }
      // An unconfirmed (503) request may or may not have been committed, but
      // never leaves half a write or a duplicate.
      const stored = await validationsCollection().countDocuments();
      expect(stored).toBeGreaterThanOrEqual(created.length);
      expect(stored).toBeLessThanOrEqual(attempts);
      await expectConsistentStores();
    });

    it('reconciles an expired commit when an Idempotency-Key is present', async () => {
      forceTransactionOptions({ maxCommitTimeMS: 1 });
      const key = 'commit-limit-key-01';

      const first = await post(BODY, key);
      // Whatever the first outcome, repeating with the same key converges.
      vi.restoreAllMocks();
      const second = await post(BODY, key).expect(201);

      expect([201, 503]).toContain(first.status);
      if (first.status === 201) {
        expect(idOf(first)).toBe(idOf(second));
      }
      expect(await validationsCollection().countDocuments()).toBe(1);
      expect(await outboxCollection().countDocuments()).toBe(1);
      await expectConsistentStores();
    });
  });

  describe('sensitive data', () => {
    it('keeps personal data, keys and secrets out of logs and error bodies', async () => {
      const logged: unknown[] = [];
      for (const level of [
        'log',
        'warn',
        'error',
        'debug',
        'verbose',
      ] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation(
          (...args: unknown[]) => {
            logged.push(args);
          },
        );
      }
      const key = 'sensitive-key-0001';
      vi.spyOn(outboxRepository, 'create').mockRejectedValueOnce(
        new Error(`failed for ${DOCUMENT} ${NAME}`),
      );
      const bodies: unknown[] = [];

      bodies.push((await post(BODY, key).expect(500)).body);
      await post(BODY, key).expect(201);
      bodies.push(
        (await post({ ...BODY, documentNumber: '777' }, key).expect(409)).body,
      );
      bodies.push((await post({ ...BODY, extra: DOCUMENT }).expect(400)).body);
      bodies.push((await post(BODY, undefined, 'ZZ').expect(400)).body);

      const text = JSON.stringify([logged, bodies]);
      for (const secret of [
        DOCUMENT,
        NAME,
        key,
        TEST_API_KEY,
        TEST_IDEMPOTENCY_SECRET,
        'requestFingerprint',
      ]) {
        expect(text).not.toContain(secret);
      }
    });
  });
});
