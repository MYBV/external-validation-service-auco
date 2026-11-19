import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import type { IAppConfig } from '../../src/config/configuration.js';
import type { IOutboxEvent } from '../../src/audit/interfaces/outbox-event.interface.js';
import {
  AUDIT_OUTBOX_COLLECTION,
  OutboxRepository,
} from '../../src/audit/repositories/outbox.repository.js';
import { ValidationAuditRepository } from '../../src/audit/repositories/validation-audit.repository.js';
import { AuditPublisher } from '../../src/audit/services/audit-publisher.service.js';
import { ensureTable } from '../../src/database/dynamo/dynamo-table.js';
import { DynamoService } from '../../src/database/dynamo/dynamo.service.js';
import { initializeMongo } from '../../src/database/init/initialize-mongo.js';
import { MongoService } from '../../src/database/mongo/mongo.service.js';
import {
  deleteTestTable,
  dropTestDatabase,
  loadIntegrationEnv,
} from '../support/integration-env.js';

const COUNTRY = 'CO';
const LEASE_MS = 60000;
const MINUTE = 60000;

/** Deterministic pseudo-random numbers so fault injection is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function timeoutError(): Error {
  const error = new Error('simulated outage');
  error.name = 'TimeoutError';
  return error;
}

describe('Audit publication and recovery (real MongoDB + DynamoDB Local)', () => {
  const { config } = loadIntegrationEnv();
  const mongo = new MongoService(config);
  const dynamo = new DynamoService(config);
  const outbox = new OutboxRepository(mongo);
  const audit = new ValidationAuditRepository(dynamo);
  const publisher = new AuditPublisher(outbox, audit, config);

  // A second DynamoDB client pointing to a closed local port: a real outage.
  const brokenConfig: IAppConfig = {
    ...config,
    dynamo: {
      ...config.dynamo,
      endpoint: 'http://127.0.0.1:1',
      timeoutMs: 500,
    },
  };
  const brokenDynamo = new DynamoService(brokenConfig);
  const brokenPublisher = new AuditPublisher(
    outbox,
    new ValidationAuditRepository(brokenDynamo),
    brokenConfig,
  );

  const collection = () =>
    mongo.db.collection<IOutboxEvent>(AUDIT_OUTBOX_COLLECTION);

  const newEvent = (overrides: Partial<IOutboxEvent> = {}): IOutboxEvent => {
    const past = new Date(Date.now() - MINUTE);
    return {
      eventId: randomUUID(),
      validationId: new ObjectId(),
      eventType: 'VALIDATION_CREATED',
      documentNumber: `doc-${randomUUID()}`,
      countryCode: COUNTRY,
      occurredAt: past,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: past,
      ...overrides,
    };
  };

  const store = async (
    overrides: Partial<IOutboxEvent> = {},
  ): Promise<IOutboxEvent> => {
    const event = newEvent(overrides);
    await outbox.create({ ...event });
    return event;
  };

  const stored = async (event: IOutboxEvent) => {
    const row = await collection().findOne({ eventId: event.eventId });
    if (row === null) {
      throw new Error('outbox event not found');
    }
    return row;
  };

  const itemsOf = (event: IOutboxEvent) =>
    audit.listByDocument(event.countryCode, event.documentNumber);

  beforeAll(async () => {
    await mongo.onModuleInit();
    await initializeMongo(mongo, [outbox]);
    await ensureTable(dynamo.client, dynamo.tableName);
  });

  afterAll(async () => {
    try {
      await dropTestDatabase(mongo);
      await deleteTestTable(dynamo);
    } finally {
      await mongo.onApplicationShutdown();
      dynamo.onApplicationShutdown();
      brokenDynamo.onApplicationShutdown();
    }
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await collection().deleteMany({});
  });

  describe('publication', () => {
    it('writes the audit item and marks the event published', async () => {
      const event = await store();

      const result = await publisher.processPendingBatch(10);

      expect(result).toMatchObject({ claimed: 1, published: 1 });
      expect(await itemsOf(event)).toEqual([
        ValidationAuditRepository.buildItem(event),
      ]);
      const row = await stored(event);
      expect(row.status).toBe('PUBLISHED');
      expect(row.publishedAt).toBeInstanceOf(Date);
      expect(row.claimToken).toBeUndefined();
      expect(row.attempts).toBe(1);
    });

    it('returns the history of one document in chronological order', async () => {
      const documentNumber = `doc-${randomUUID()}`;
      const base = Date.now() - 10 * MINUTE;
      const events: IOutboxEvent[] = [];
      // Stored in reverse order on purpose.
      for (const offset of [3000, 2000, 1000]) {
        events.push(
          await store({
            documentNumber,
            occurredAt: new Date(base + offset),
          }),
        );
      }

      await publisher.processPendingBatch(10);

      const history = await audit.listByDocument(COUNTRY, documentNumber);
      expect(history.map((item) => item.createdAt)).toEqual(
        [...events]
          .map((event) => event.occurredAt.toISOString())
          .sort((a, b) => a.localeCompare(b)),
      );
    });

    it('keeps the same document of another country in a separate history', async () => {
      const documentNumber = `doc-${randomUUID()}`;
      const co = await store({ documentNumber });
      const mx = await store({ documentNumber, countryCode: 'MX' });

      await publisher.processPendingBatch(10);

      expect(await itemsOf(co)).toHaveLength(1);
      expect(await itemsOf(mx)).toHaveLength(1);
    });
  });

  describe('idempotency and reconciliation', () => {
    it('does not duplicate the item when the same event is processed again', async () => {
      const event = await store();
      await publisher.processPendingBatch(10);

      await collection().updateOne(
        { eventId: event.eventId },
        { $set: { status: 'PENDING', nextAttemptAt: new Date(0) } },
      );
      const again = await publisher.processPendingBatch(10);

      expect(again.published).toBe(1);
      expect(await itemsOf(event)).toHaveLength(1);
      expect((await stored(event)).status).toBe('PUBLISHED');
    });

    it('reconciles after the outbox update failed once: stored, pending, then published', async () => {
      const event = await store();
      vi.spyOn(outbox, 'markPublished').mockRejectedValueOnce(
        new Error('mongo hiccup'),
      );

      const first = await publisher.processPendingBatch(10);

      expect(first).toMatchObject({ claimed: 1, unsettled: 1, published: 0 });
      expect(await itemsOf(event)).toHaveLength(1);
      expect((await stored(event)).status).toBe('PENDING');

      // Not eligible while the lease is alive, eligible after it expires.
      expect((await publisher.processPendingBatch(10)).claimed).toBe(0);
      const later = new Date(Date.now() + LEASE_MS + 1000);
      const second = await publisher.processPendingBatch(10, { now: later });

      expect(second.published).toBe(1);
      expect(await itemsOf(event)).toHaveLength(1);
      expect((await stored(event)).status).toBe('PUBLISHED');
    });

    it('quarantines a collision with a different event and leaves the existing item untouched', async () => {
      const event = await store();
      const intruder = {
        ...ValidationAuditRepository.buildItem(event),
        eventId: 'intruder',
      };
      await audit.putIfNotExists(intruder);

      const result = await publisher.processPendingBatch(10);

      expect(result).toMatchObject({ claimed: 1, failed: 1, published: 0 });
      const row = await stored(event);
      expect(row.status).toBe('FAILED');
      expect(row.lastErrorCode).toBe('AUDIT_KEY_COLLISION');
      expect(row.failedAt).toBeInstanceOf(Date);
      expect(await itemsOf(event)).toEqual([intruder]);
    });

    it('never retries a failed event automatically', async () => {
      const event = await store();
      await audit.putIfNotExists({
        ...ValidationAuditRepository.buildItem(event),
        eventId: 'intruder',
      });
      await publisher.processPendingBatch(10);

      const later = new Date(Date.now() + 24 * 60 * MINUTE);
      const again = await publisher.processPendingBatch(10, { now: later });

      expect(again.claimed).toBe(0);
      expect((await stored(event)).attempts).toBe(1);
    });
  });

  describe('DynamoDB unavailable', () => {
    it('keeps the event pending with backoff and recovers when DynamoDB is back', async () => {
      const event = await store();
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const before = Date.now();

      const failed = await brokenPublisher.processPendingBatch(10);

      expect(failed).toMatchObject({ claimed: 1, retried: 1, published: 0 });
      const pending = await stored(event);
      expect(pending.status).toBe('PENDING');
      expect(pending.attempts).toBe(1);
      expect(pending.lastErrorCode).toEqual(expect.any(String));
      expect(pending.claimToken).toBeUndefined();
      expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(before + 3000);
      expect(await itemsOf(event)).toHaveLength(0);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        event.documentNumber,
      );

      // Backoff has not elapsed: nothing to do yet.
      expect((await publisher.processPendingBatch(10)).claimed).toBe(0);

      const recovered = await publisher.processPendingBatch(10, {
        now: new Date(pending.nextAttemptAt.getTime() + 1),
      });

      expect(recovered.published).toBe(1);
      expect(await itemsOf(event)).toHaveLength(1);
      const row = await stored(event);
      expect(row.status).toBe('PUBLISHED');
      expect(row.attempts).toBe(2);
      expect(row.lastErrorCode).toBeUndefined();
    });
  });

  describe('claim, lease and fencing', () => {
    it('lets only one claimant take an event and recovers it when the lease expires', async () => {
      const event = await store();
      const now = new Date();

      const first = await outbox.claimNext(now, LEASE_MS, 'A');
      const during = await outbox.claimNext(
        new Date(now.getTime() + 1000),
        LEASE_MS,
        'B',
      );
      const after = await outbox.claimNext(
        new Date(now.getTime() + LEASE_MS + 1),
        LEASE_MS,
        'C',
      );

      expect(first?.eventId).toBe(event.eventId);
      expect(first?.attempts).toBe(1);
      expect(during).toBeNull();
      expect(after?.eventId).toBe(event.eventId);
      expect(after?.attempts).toBe(2);
      expect(after?.claimToken).toBe('C');
    });

    it('does not let an old attempt overwrite the state of a newer claim', async () => {
      const event = await store();
      const now = new Date();
      await outbox.claimNext(now, LEASE_MS, 'A');
      const expiredAt = new Date(now.getTime() + LEASE_MS + 1);
      await outbox.claimNext(expiredAt, LEASE_MS, 'B');
      const claimB = await stored(event);

      const lateRetry = await outbox.markRetry(
        event.eventId,
        'A',
        new Date(0),
        'LATE',
        new Date(),
      );
      const lateFailure = await outbox.markFailed(
        event.eventId,
        'A',
        'LATE',
        new Date(),
      );

      expect(lateRetry).toBe(false);
      expect(lateFailure).toBe(false);
      expect(await stored(event)).toEqual(claimB);
    });

    it('ignores the late failure of an attempt that lost its claim (publisher level)', async () => {
      const event = await store();
      const now = new Date();
      const claimA = await outbox.claimNext(now, LEASE_MS, 'A');
      await outbox.claimNext(
        new Date(now.getTime() + LEASE_MS + 1),
        LEASE_MS,
        'B',
      );
      const claimB = await stored(event);
      if (claimA === null) {
        throw new Error('claim A expected');
      }

      const outcome = await brokenPublisher.publishClaimed(claimA, now);

      expect(outcome).toBe('stale');
      expect(await stored(event)).toEqual(claimB);
    });

    it('settles as published only with the identity of the right event', async () => {
      const event = await store();
      const row = await outbox.claimNext(new Date(), LEASE_MS, 'A');

      const wrong = await outbox.markPublished(
        event.eventId,
        new ObjectId(),
        new Date(),
      );
      const right = await outbox.markPublished(
        event.eventId,
        event.validationId,
        new Date(),
      );

      expect(row).not.toBeNull();
      expect(wrong).toBe(false);
      expect(right).toBe(true);
      expect((await stored(event)).status).toBe('PUBLISHED');
    });

    it('does not let a late success undo or duplicate anything after another claim published', async () => {
      const event = await store();
      await publisher.processPendingBatch(10);

      const lateRetry = await outbox.markRetry(
        event.eventId,
        'A',
        new Date(0),
        'LATE',
        new Date(),
      );

      expect(lateRetry).toBe(false);
      expect((await stored(event)).status).toBe('PUBLISHED');
      expect(await itemsOf(event)).toHaveLength(1);
    });
  });

  describe('limits and concurrency', () => {
    it('respects the batch size and only processes eligible events', async () => {
      const future = new Date(Date.now() + 10 * MINUTE);
      const eligible = [await store(), await store(), await store()];
      const notYet = [
        await store({ nextAttemptAt: future }),
        await store({ nextAttemptAt: future }),
      ];

      const result = await publisher.processPendingBatch(2);

      expect(result.claimed).toBe(2);
      const rows = await collection().find({ attempts: 0 }).toArray();
      expect(rows).toHaveLength(3);
      for (const event of notYet) {
        expect((await stored(event)).attempts).toBe(0);
      }
      const untouchedEligible = (
        await Promise.all(eligible.map((event) => stored(event)))
      ).filter((row) => row.attempts === 0);
      expect(untouchedEligible).toHaveLength(1);
    });

    it('lets two workers share the same backlog without double processing', async () => {
      const events: IOutboxEvent[] = [];
      for (let i = 0; i < 30; i++) {
        events.push(await store());
      }
      const other = new AuditPublisher(
        new OutboxRepository(mongo),
        new ValidationAuditRepository(dynamo),
        config,
      );

      const [a, b] = await Promise.all([
        publisher.processPendingBatch(100),
        other.processPendingBatch(100),
      ]);

      expect(a.claimed + b.claimed).toBe(30);
      expect(a.published + b.published).toBe(30);
      for (const event of events) {
        const row = await stored(event);
        expect(row.status).toBe('PUBLISHED');
        expect(row.attempts).toBe(1);
        expect(await itemsOf(event)).toHaveLength(1);
      }
    });

    it('produces one item when two publishers write the same event at once (no claim shortcut)', async () => {
      const event = await store();
      const claim = await outbox.claimNext(new Date(), LEASE_MS, 'A');
      if (claim === null) {
        throw new Error('claim expected');
      }

      const outcomes = await Promise.all([
        publisher.publishClaimed(claim, new Date()),
        publisher.publishClaimed(claim, new Date()),
      ]);

      expect(
        outcomes.filter((outcome) => outcome === 'published'),
      ).toHaveLength(1);
      expect(await itemsOf(event)).toHaveLength(1);
    });

    it('loses and duplicates nothing under random failures and lost acknowledgements', async () => {
      const random = seededRandom(20260301);
      const events: IOutboxEvent[] = [];
      for (let i = 0; i < 40; i++) {
        events.push(await store());
      }
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const originalPut = audit.putIfNotExists.bind(audit);
      vi.spyOn(audit, 'putIfNotExists').mockImplementation(
        async (item, options) => {
          const roll = random();
          if (roll < 0.2) {
            throw timeoutError(); // request never reached DynamoDB
          }
          await originalPut(item, options);
          if (roll < 0.4) {
            throw timeoutError(); // stored, but the acknowledgement was lost
          }
        },
      );
      const originalPublish = outbox.markPublished.bind(outbox);
      vi.spyOn(outbox, 'markPublished').mockImplementation(
        async (eventId, validationId, now) => {
          if (random() < 0.25) {
            throw new Error('mongo hiccup');
          }
          return originalPublish(eventId, validationId, now);
        },
      );

      let clock = Date.now();
      let pending = events.length;
      for (let cycle = 0; cycle < 60 && pending > 0; cycle++) {
        clock += 10 * MINUTE; // every backoff and lease has elapsed
        await publisher.processPendingBatch(100, { now: new Date(clock) });
        pending = await collection().countDocuments({ status: 'PENDING' });
      }

      expect(pending).toBe(0);
      expect(await collection().countDocuments({ status: 'FAILED' })).toBe(0);
      for (const event of events) {
        expect((await stored(event)).status).toBe('PUBLISHED');
        expect(await itemsOf(event)).toEqual([
          ValidationAuditRepository.buildItem(event),
        ]);
      }
    });
  });
});
