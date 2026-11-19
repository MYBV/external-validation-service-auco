import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { type INestApplication } from '@nestjs/common';
import { MongoError, ObjectId } from 'mongodb';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { IOutboxEvent } from '../../src/audit/interfaces/outbox-event.interface.js';
import { AUDIT_OUTBOX_COLLECTION } from '../../src/audit/repositories/outbox.repository.js';
import { ValidationAuditRepository } from '../../src/audit/repositories/validation-audit.repository.js';
import { CountriesService } from '../../src/countries/services/countries.service.js';
import { ensureTable } from '../../src/database/dynamo/dynamo-table.js';
import { DynamoService } from '../../src/database/dynamo/dynamo.service.js';
import { initializeMongo } from '../../src/database/init/initialize-mongo.js';
import type { MongoService } from '../../src/database/mongo/mongo.service.js';
import {
  createTestApp,
  type ITestAppClasses,
  TEST_API_KEY,
} from '../support/create-test-app.js';
import {
  deleteTestTable,
  dropTestDatabase,
  loadIntegrationEnv,
} from '../support/integration-env.js';
import { TcpProxy } from '../support/tcp-proxy.js';
import {
  makeRestCountriesFake,
  SAMPLE_ENRICHMENT,
} from '../support/validations-fakes.js';
import { waitFor } from '../support/wait-for.js';

const MINUTE = 60000;
const INLINE_BUDGET_MS = 1500;

interface IRunningApp {
  readonly app: INestApplication<App>;
  readonly classes: ITestAppClasses;
}

describe('Audit recovery after a DynamoDB outage (real MongoDB + DynamoDB Local)', () => {
  const { config } = loadIntegrationEnv();
  const restCountries = makeRestCountriesFake();
  const endpoint = new URL(config.dynamo.endpoint ?? '');
  const proxy = new TcpProxy(endpoint.hostname, Number(endpoint.port));

  // Direct access to DynamoDB Local (not through the proxy) to inspect items.
  const directDynamo = new DynamoService(config);
  const directAudit = new ValidationAuditRepository(directDynamo);

  const apps: IRunningApp[] = [];
  let primary: IRunningApp;
  let mongo: MongoService;

  const startApp = async (
    overrides: Record<string, string> = {},
  ): Promise<IRunningApp> => {
    let classes: ITestAppClasses | undefined;
    const app = await createTestApp(
      {
        MONGO_URI: config.mongo.uri ?? '',
        MONGO_DB_NAME: config.mongo.dbName,
        DYNAMODB_ENDPOINT: `http://127.0.0.1:${proxy.port}`,
        DYNAMODB_TABLE: config.dynamo.table,
        DYNAMODB_TIMEOUT_MS: '500',
        REQUEST_TIMEOUT_MS: '20000',
        AUDIT_INLINE_TIMEOUT_MS: String(INLINE_BUDGET_MS),
        AUDIT_WORKER_ENABLED: 'false',
        ...overrides,
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
    if (classes === undefined) {
      throw new Error('classes were not captured');
    }
    const running = { app, classes };
    apps.push(running);
    return running;
  };

  const outboxCollection = () =>
    mongo.db.collection<IOutboxEvent>(AUDIT_OUTBOX_COLLECTION);

  const createValidation = (running: IRunningApp, documentNumber: string) =>
    request(running.app.getHttpServer())
      .post('/validations')
      .set('x-api-key', TEST_API_KEY)
      .set('x-country-code', 'CO')
      .send({ name: 'Maria Fernanda Lopez', documentNumber });

  const eventOf = async (validationId: string): Promise<IOutboxEvent> => {
    const row = await outboxCollection().findOne({
      validationId: new ObjectId(validationId),
    });
    if (row === null) {
      throw new Error('outbox event not found');
    }
    return row;
  };

  /** Final state of work that may still be running in the background. */
  const waitForSettled = (validationId: string) =>
    waitFor(async () => {
      const row = await eventOf(validationId);
      return row.claimToken === undefined ? row : undefined;
    });

  const idOf = (response: request.Response): string =>
    (response.body as { data: { id: string } }).data.id;

  beforeAll(async () => {
    await proxy.start();
    await ensureTable(directDynamo.client, directDynamo.tableName);
    primary = await startApp();
    mongo = primary.app.get(primary.classes.MongoService);
    const countryRepository = primary.app.get(
      primary.classes.CountryRepository,
    );
    await initializeMongo(mongo, [
      countryRepository,
      primary.app.get(primary.classes.ValidationRepository),
      primary.app.get(primary.classes.OutboxRepository),
    ]);
    await new CountriesService(countryRepository).seed();
  });

  afterAll(async () => {
    try {
      await dropTestDatabase(mongo);
      await deleteTestTable(directDynamo);
    } finally {
      for (const running of apps.reverse()) {
        await running.app.close().catch(() => undefined);
      }
      directDynamo.onApplicationShutdown();
      await proxy.stop();
    }
  });

  afterEach(async () => {
    // Apps started by a test (some run a recovery worker) must not outlive it
    // and publish events of later tests. The primary app stays.
    for (const running of apps.splice(1)) {
      await running.app.close().catch(() => undefined);
    }
  });

  beforeEach(async () => {
    if (!proxy.isUp) {
      await proxy.start();
    }
    proxy.forward();
    await outboxCollection().deleteMany({});
  });

  it('answers 201 during the outage, keeps the event recoverable and publishes it once DynamoDB is back', async () => {
    const documentNumber = `doc-${randomUUID()}`;
    const publisher = primary.app.get(primary.classes.AuditPublisher);
    await proxy.stop();

    // MongoDB commits validation + outbox; DynamoDB is unreachable.
    const started = Date.now();
    const created = await createValidation(primary, documentNumber).expect(201);
    expect(Date.now() - started).toBeLessThan(INLINE_BUDGET_MS + 3000);
    const id = idOf(created);
    expect(Object.keys(created.body as object)).toEqual(['data']);
    expect(Object.keys((created.body as { data: object }).data)).toEqual([
      'id',
    ]);

    // The inline attempt may outlive its budget: wait for its final state.
    const pending = await waitForSettled(id);
    expect(pending.status).toBe('PENDING');
    expect(pending.attempts).toBeGreaterThanOrEqual(1);
    expect(pending.lastErrorCode).toEqual(expect.any(String));
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(await directAudit.listByDocument('CO', documentNumber)).toHaveLength(
      0,
    );

    // The public contract is untouched and hides the outbox.
    const read = await request(primary.app.getHttpServer())
      .get(`/validations/${id}`)
      .set('x-api-key', TEST_API_KEY)
      .expect(200);
    const publicText = JSON.stringify(read.body);
    for (const internal of ['eventId', 'status', 'attempts', 'claimToken']) {
      expect(publicText).not.toContain(internal);
    }

    // Recovery attempt while still down: stays pending, nothing is lost.
    const stillDown = await publisher.processPendingBatch(10, {
      now: new Date(pending.nextAttemptAt.getTime() + 1),
    });
    expect(stillDown).toMatchObject({ claimed: 1, retried: 1, published: 0 });
    const afterSecond = await eventOf(id);
    expect(afterSecond.status).toBe('PENDING');
    expect(afterSecond.attempts).toBe(pending.attempts + 1);

    // DynamoDB comes back: the worker cycle publishes the event.
    await proxy.start();
    const recovered = await publisher.processPendingBatch(10, {
      now: new Date(afterSecond.nextAttemptAt.getTime() + 1),
    });
    expect(recovered).toMatchObject({ claimed: 1, published: 1 });
    const published = await eventOf(id);
    expect(published.status).toBe('PUBLISHED');
    expect(published.publishedAt).toBeInstanceOf(Date);
    const items = await directAudit.listByDocument('CO', documentNumber);
    expect(items).toEqual([ValidationAuditRepository.buildItem(published)]);

    // Reprocessing (as if the status update had been lost) adds nothing.
    await outboxCollection().updateOne(
      { eventId: published.eventId },
      { $set: { status: 'PENDING', nextAttemptAt: new Date(0) } },
    );
    const [first, second] = await Promise.all([
      publisher.processPendingBatch(10),
      publisher.processPendingBatch(10),
    ]);
    expect(first.claimed + second.claimed).toBe(1);
    expect((await eventOf(id)).status).toBe('PUBLISHED');
    expect(await directAudit.listByDocument('CO', documentNumber)).toHaveLength(
      1,
    );
  });

  it('publishes inline when DynamoDB is available', async () => {
    const documentNumber = `doc-${randomUUID()}`;

    const id = idOf(
      await createValidation(primary, documentNumber).expect(201),
    );

    const row = await waitFor(async () => {
      const current = await eventOf(id);
      return current.status === 'PUBLISHED' ? current : undefined;
    });
    expect(row.attempts).toBe(1);
    expect(await directAudit.listByDocument('CO', documentNumber)).toEqual([
      ValidationAuditRepository.buildItem(row),
    ]);
  });

  it('answers 201 and publishes after an unknown commit result that actually committed', async () => {
    const documentNumber = `doc-${randomUUID()}`;
    const original = mongo.withTransaction.bind(mongo);
    vi.spyOn(mongo, 'withTransaction').mockImplementationOnce(async (work) => {
      await original(work); // the commit really happens...
      const unknown = new MongoError('commit outcome unknown');
      unknown.addErrorLabel('UnknownTransactionCommitResult');
      throw unknown; // ...but the caller never learns it
    });

    const created = await createValidation(primary, documentNumber).expect(201);

    const row = await waitFor(async () => {
      const current = await eventOf(idOf(created));
      return current.status === 'PUBLISHED' ? current : undefined;
    });
    expect(await directAudit.listByDocument('CO', documentNumber)).toHaveLength(
      1,
    );
    expect(row.attempts).toBe(1);
    vi.restoreAllMocks();
  });

  it('recovers autonomously: the worker publishes without any new HTTP request', async () => {
    const documentNumber = `doc-${randomUUID()}`;
    const withWorker = await startApp({
      AUDIT_WORKER_ENABLED: 'true',
      AUDIT_WORKER_INTERVAL_MS: '200',
    });
    await proxy.stop();

    const id = idOf(
      await createValidation(withWorker, documentNumber).expect(201),
    );
    const pending = await waitForSettled(id);
    expect(pending.status).toBe('PENDING');
    expect(await directAudit.listByDocument('CO', documentNumber)).toHaveLength(
      0,
    );

    // DynamoDB is back and the backoff window has elapsed (simulated by
    // moving the due time, so the test does not wait for the real delay).
    await proxy.start();
    await outboxCollection().updateOne(
      { eventId: pending.eventId },
      { $set: { nextAttemptAt: new Date(Date.now() - MINUTE) } },
    );

    const row = await waitFor(
      async () => {
        const current = await eventOf(id);
        return current.status === 'PUBLISHED' ? current : undefined;
      },
      { timeoutMs: 20000 },
    );
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(await directAudit.listByDocument('CO', documentNumber)).toHaveLength(
      1,
    );

    // The worker stops cleanly with the application.
    await withWorker.app.close();
    apps.splice(apps.indexOf(withWorker), 1);
  });

  it('answers 201 within the inline budget when DynamoDB accepts connections but never answers, and the worker recovers the event later', async () => {
    const documentNumber = `doc-${randomUUID()}`;
    // The SDK timeout is far above the inline budget: the budget (and its
    // abort signal) is what must cut the hung call.
    const withWorker = await startApp({
      AUDIT_WORKER_ENABLED: 'true',
      AUDIT_WORKER_INTERVAL_MS: '200',
      DYNAMODB_TIMEOUT_MS: '5000',
    });
    proxy.blackhole();

    const started = Date.now();
    const created = await createValidation(withWorker, documentNumber).expect(
      201,
    );
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(INLINE_BUDGET_MS - 100);
    expect(elapsed).toBeLessThan(INLINE_BUDGET_MS + 1500);
    const id = idOf(created);

    // Final state of the (possibly still finishing) inline operation: the
    // aborted call is ambiguous, so there is no PUBLISHED without evidence.
    const pending = await waitForSettled(id);
    expect(pending.status).toBe('PENDING');
    expect(pending.lastErrorCode).toBe('AUDIT_ABORTED');
    expect(await directAudit.listByDocument('CO', documentNumber)).toHaveLength(
      0,
    );

    // DynamoDB answers again; the backoff window is simulated as elapsed.
    proxy.forward();
    await outboxCollection().updateOne(
      { eventId: pending.eventId },
      { $set: { nextAttemptAt: new Date(Date.now() - MINUTE) } },
    );
    const published = await waitFor(
      async () => {
        const current = await eventOf(id);
        return current.status === 'PUBLISHED' ? current : undefined;
      },
      { timeoutMs: 20000 },
    );
    expect(await directAudit.listByDocument('CO', documentNumber)).toEqual([
      ValidationAuditRepository.buildItem(published),
    ]);

    // Reprocessing the event (as if the status update had been lost) adds nothing.
    await outboxCollection().updateOne(
      { eventId: published.eventId },
      { $set: { status: 'PENDING', nextAttemptAt: new Date(0) } },
    );
    await waitFor(async () => {
      const current = await eventOf(id);
      return current.status === 'PUBLISHED' &&
        current.attempts > published.attempts
        ? current
        : undefined;
    });
    expect(await directAudit.listByDocument('CO', documentNumber)).toHaveLength(
      1,
    );
  });

  describe('inline budget tied to the HTTP request', () => {
    // REQUEST_TIMEOUT_MS=2000, inline 1000: without the per-request budget a
    // request that spent 1.1 s before the commit would need 2.1 s in total.
    const tightOverrides = {
      REQUEST_TIMEOUT_MS: '2000',
      AUDIT_INLINE_TIMEOUT_MS: '1000',
      DYNAMODB_TIMEOUT_MS: '5000',
    };
    const slowEnrichment = (ms: number): void => {
      restCountries.enrich.mockImplementationOnce(async (code: string) => {
        await sleep(ms);
        return { ...SAMPLE_ENRICHMENT, code };
      });
    };

    it('skips the inline attempt when the request used almost all its time, leaving the event for the worker', async () => {
      const documentNumber = `doc-${randomUUID()}`;
      const tight = await startApp(tightOverrides);
      const publisher = tight.app.get(tight.classes.AuditPublisher);
      slowEnrichment(1450); // DynamoDB is healthy: only the budget can skip

      const started = Date.now();
      const created = await createValidation(tight, documentNumber).expect(201);
      expect(Date.now() - started).toBeLessThan(2000);
      const id = idOf(created);

      await sleep(300);
      const untouched = await eventOf(id);
      expect(untouched.status).toBe('PENDING');
      expect(untouched.attempts).toBe(0); // never claimed
      expect(untouched.claimToken).toBeUndefined();
      expect(
        await directAudit.listByDocument('CO', documentNumber),
      ).toHaveLength(0);

      const result = await publisher.processPendingBatch(10);
      expect(result).toMatchObject({ claimed: 1, published: 1 });
      expect((await eventOf(id)).status).toBe('PUBLISHED');
      expect(
        await directAudit.listByDocument('CO', documentNumber),
      ).toHaveLength(1);
    });

    it('shortens the inline budget to the time left so a hung DynamoDB cannot push the response past the request timeout', async () => {
      const documentNumber = `doc-${randomUUID()}`;
      const tight = await startApp(tightOverrides);
      const publisher = tight.app.get(tight.classes.AuditPublisher);
      proxy.blackhole();
      slowEnrichment(1100);

      const started = Date.now();
      const created = await createValidation(tight, documentNumber).expect(201);
      expect(Date.now() - started).toBeLessThan(2000); // no 504
      const id = idOf(created);

      const pending = await waitForSettled(id);
      expect(pending.status).toBe('PENDING');
      expect(
        await directAudit.listByDocument('CO', documentNumber),
      ).toHaveLength(0);

      proxy.forward();
      const result = await publisher.processPendingBatch(10, {
        now: new Date(Date.now() + MINUTE),
      });
      expect(result.published).toBe(1);
      expect(
        await directAudit.listByDocument('CO', documentNumber),
      ).toHaveLength(1);
    });
  });
});
