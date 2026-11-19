import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { Logger } from '@nestjs/common';
import { ObjectId, type WithId } from 'mongodb';
import { makeAppConfig } from '../../../test/support/app-config.js';
import type { IValidationAuditItem } from '../interfaces/audit-item.interface.js';
import type { IOutboxEvent } from '../interfaces/outbox-event.interface.js';
import type { OutboxRepository } from '../repositories/outbox.repository.js';
import { ValidationAuditRepository } from '../repositories/validation-audit.repository.js';
import {
  AuditPublisher,
  MIN_INLINE_BUDGET_MS,
  RESPONSE_MARGIN_MS,
} from './audit-publisher.service.js';

const DOCUMENT = '1020304050';
const NOW = new Date('2026-03-01T10:00:00.000Z');

function claimed(overrides: Partial<IOutboxEvent> = {}): WithId<IOutboxEvent> {
  return {
    _id: new ObjectId(),
    eventId: '6f1c2b8e-0000-4000-8000-000000000001',
    validationId: new ObjectId(),
    eventType: 'VALIDATION_CREATED',
    documentNumber: DOCUMENT,
    countryCode: 'CO',
    occurredAt: new Date('2026-03-01T09:59:00.000Z'),
    status: 'PENDING',
    attempts: 1,
    nextAttemptAt: new Date(NOW.getTime() + 60000),
    claimToken: 'token-1',
    ...overrides,
  };
}

function named(name: string, message = `failure for ${DOCUMENT}`): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function conditionalFailure(): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({
    message: 'The conditional request failed',
    $metadata: {},
  });
}

function setup(env: Record<string, string> = {}) {
  const outbox = {
    claimNext: vi.fn().mockResolvedValue(null),
    claimById: vi.fn().mockResolvedValue(null),
    markPublished: vi.fn().mockResolvedValue(true),
    markRetry: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
  };
  const audit = {
    putIfNotExists: vi.fn().mockResolvedValue(undefined),
    findExisting: vi.fn().mockResolvedValue(undefined),
  };
  const publisher = new AuditPublisher(
    outbox as unknown as OutboxRepository,
    audit as unknown as ValidationAuditRepository,
    makeAppConfig({ AUDIT_BACKOFF_MAX_MS: '300000', ...env }),
  );
  return { publisher, outbox, audit };
}

describe('AuditPublisher', () => {
  describe('publishClaimed', () => {
    it('marks the event published after a confirmed conditional put', async () => {
      const { publisher, outbox, audit } = setup();
      const event = claimed();

      const outcome = await publisher.publishClaimed(event, NOW);

      expect(outcome).toBe('published');
      expect(audit.putIfNotExists).toHaveBeenCalledWith(
        ValidationAuditRepository.buildItem(event),
        { abortSignal: undefined },
      );
      expect(outbox.markPublished).toHaveBeenCalledWith(
        event.eventId,
        event.validationId,
        expect.any(Date),
      );
      expect(outbox.markRetry).not.toHaveBeenCalled();
      expect(outbox.markFailed).not.toHaveBeenCalled();
    });

    it('writes the identical item on every attempt (stable keys and event id)', async () => {
      const { publisher, audit } = setup();
      const event = claimed();

      await publisher.publishClaimed(event, NOW);
      await publisher.publishClaimed({ ...event, attempts: 5 }, NOW);

      const [first, second] = audit.putIfNotExists.mock.calls.map(
        (call) => call[0] as IValidationAuditItem,
      );
      expect(second).toEqual(first);
    });

    it('treats a conditional failure with the same identity as a valid replay', async () => {
      const { publisher, outbox, audit } = setup();
      const event = claimed();
      audit.putIfNotExists.mockRejectedValue(conditionalFailure());
      audit.findExisting.mockResolvedValue(
        ValidationAuditRepository.buildItem(event),
      );

      const outcome = await publisher.publishClaimed(event, NOW);

      expect(outcome).toBe('published');
      expect(audit.findExisting).toHaveBeenCalledTimes(1);
      expect(outbox.markPublished).toHaveBeenCalledTimes(1);
    });

    it('quarantines a real collision with a different event and never publishes', async () => {
      const { publisher, outbox, audit } = setup();
      const event = claimed();
      audit.putIfNotExists.mockRejectedValue(conditionalFailure());
      audit.findExisting.mockResolvedValue({
        ...ValidationAuditRepository.buildItem(event),
        eventId: 'another-event',
      });

      const outcome = await publisher.publishClaimed(event, NOW);

      expect(outcome).toBe('failed');
      expect(outbox.markFailed).toHaveBeenCalledWith(
        event.eventId,
        'token-1',
        'AUDIT_KEY_COLLISION',
        expect.any(Date),
      );
      expect(outbox.markPublished).not.toHaveBeenCalled();
    });

    it('does not publish when the conditional failure cannot be verified', async () => {
      const { publisher, outbox, audit } = setup();
      audit.putIfNotExists.mockRejectedValue(conditionalFailure());
      audit.findExisting.mockResolvedValue(undefined);

      const outcome = await publisher.publishClaimed(claimed(), NOW);

      expect(outcome).toBe('retried');
      expect(outbox.markPublished).not.toHaveBeenCalled();
      expect(outbox.markRetry).toHaveBeenCalledWith(
        expect.any(String),
        'token-1',
        expect.any(Date),
        'AUDIT_ITEM_MISSING',
        expect.any(Date),
      );
    });

    it('keeps the event pending with backoff when DynamoDB is unavailable', async () => {
      const { publisher, outbox, audit } = setup();
      audit.putIfNotExists.mockRejectedValue(named('TimeoutError'));
      const event = claimed({ attempts: 1 });

      const outcome = await publisher.publishClaimed(event, NOW);

      expect(outcome).toBe('retried');
      const [eventId, token, nextAttemptAt, code] = outbox.markRetry.mock
        .calls[0] as [string, string, Date, string];
      expect(eventId).toBe(event.eventId);
      expect(token).toBe('token-1');
      expect(code).toBe('TimeoutError');
      const delay = nextAttemptAt.getTime() - NOW.getTime();
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThanOrEqual(6000 + 500); // plus real elapsed time
      expect(outbox.markPublished).not.toHaveBeenCalled();
    });

    it('grows the delay with the attempt count and respects the cap', async () => {
      const { publisher, outbox, audit } = setup({
        AUDIT_BACKOFF_MAX_MS: '20000',
      });
      audit.putIfNotExists.mockRejectedValue(named('TimeoutError'));

      await publisher.publishClaimed(claimed({ attempts: 50 }), NOW);

      const nextAttemptAt = outbox.markRetry.mock.calls[0]?.[2] as Date;
      // The cap applies to the delay; real elapsed time of the attempt is extra.
      expect(nextAttemptAt.getTime() - NOW.getTime()).toBeLessThanOrEqual(
        20000 + 500,
      );
    });

    it('schedules the retry from the moment of the failure, not from the claim', async () => {
      vi.useFakeTimers();
      try {
        const { publisher, outbox, audit } = setup();
        // The attempt itself takes 7 s before failing.
        audit.putIfNotExists.mockImplementation(() => {
          vi.setSystemTime(Date.now() + 7000);
          return Promise.reject(named('TimeoutError'));
        });

        await publisher.publishClaimed(claimed({ attempts: 1 }), NOW);

        const nextAttemptAt = outbox.markRetry.mock.calls[0]?.[2] as Date;
        const delay = nextAttemptAt.getTime() - NOW.getTime();
        // 7 s of attempt + 5 s base delay (+-20 % jitter).
        expect(delay).toBeGreaterThanOrEqual(7000 + 4000);
        expect(delay).toBeLessThanOrEqual(7000 + 6000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('treats an aborted request as ambiguous: never published', async () => {
      const { publisher, outbox, audit } = setup();
      audit.putIfNotExists.mockRejectedValue(named('AbortError'));

      const outcome = await publisher.publishClaimed(claimed(), NOW);

      expect(outcome).toBe('retried');
      expect(outbox.markPublished).not.toHaveBeenCalled();
    });

    it('keeps the event pending when DynamoDB answers ValidationException (operational, recoverable)', async () => {
      const { publisher, outbox, audit } = setup();
      audit.putIfNotExists.mockRejectedValue(named('ValidationException'));

      const outcome = await publisher.publishClaimed(claimed(), NOW);

      expect(outcome).toBe('retried');
      expect(outbox.markFailed).not.toHaveBeenCalled();
      expect(outbox.markPublished).not.toHaveBeenCalled();
      expect(outbox.markRetry).toHaveBeenCalledWith(
        expect.any(String),
        'token-1',
        expect.any(Date),
        'ValidationException',
        expect.any(Date),
      );
    });

    it('quarantines an outbox event that cannot become an audit item', async () => {
      const { publisher, outbox, audit } = setup();
      const broken = claimed({ occurredAt: new Date(Number.NaN) });

      const outcome = await publisher.publishClaimed(broken, NOW);

      expect(outcome).toBe('failed');
      expect(audit.putIfNotExists).not.toHaveBeenCalled();
      expect(outbox.markFailed).toHaveBeenCalledWith(
        broken.eventId,
        'token-1',
        'AUDIT_ITEM_INVALID',
        expect.any(Date),
      );
    });

    it('leaves the event pending (unsettled) when the outbox update fails after the put', async () => {
      const { publisher, outbox } = setup();
      outbox.markPublished.mockRejectedValue(named('MongoNetworkError'));

      const outcome = await publisher.publishClaimed(claimed(), NOW);

      expect(outcome).toBe('unsettled');
      expect(outbox.markRetry).not.toHaveBeenCalled();
      expect(outbox.markFailed).not.toHaveBeenCalled();
    });

    it('reports stale when another publication already settled the event', async () => {
      const { publisher, outbox } = setup();
      outbox.markPublished.mockResolvedValue(false);

      expect(await publisher.publishClaimed(claimed(), NOW)).toBe('stale');
    });

    it('reports stale when a newer claim fenced the retry', async () => {
      const { publisher, outbox, audit } = setup();
      audit.putIfNotExists.mockRejectedValue(named('TimeoutError'));
      outbox.markRetry.mockResolvedValue(false);

      expect(await publisher.publishClaimed(claimed(), NOW)).toBe('stale');
    });

    it('does not throw when recording the failure also fails', async () => {
      const { publisher, outbox, audit } = setup();
      audit.putIfNotExists.mockRejectedValue(named('TimeoutError'));
      outbox.markRetry.mockRejectedValue(named('MongoNetworkError'));

      expect(await publisher.publishClaimed(claimed(), NOW)).toBe('unsettled');
    });
  });

  describe('processPendingBatch', () => {
    it('claims one event at a time until none is eligible', async () => {
      const { publisher, outbox } = setup();
      outbox.claimNext
        .mockResolvedValueOnce(claimed({ eventId: 'e1' }))
        .mockResolvedValueOnce(claimed({ eventId: 'e2' }))
        .mockResolvedValue(null);

      const result = await publisher.processPendingBatch(10, { now: NOW });

      expect(result).toEqual({
        claimed: 2,
        published: 2,
        retried: 0,
        failed: 0,
        stale: 0,
        unsettled: 0,
      });
      expect(outbox.claimNext).toHaveBeenCalledWith(
        NOW,
        60000,
        expect.any(String),
      );
    });

    it('never claims more than the batch limit', async () => {
      const { publisher, outbox } = setup();
      outbox.claimNext.mockImplementation(() => Promise.resolve(claimed()));

      const result = await publisher.processPendingBatch(3, { now: NOW });

      expect(result.claimed).toBe(3);
      expect(outbox.claimNext).toHaveBeenCalledTimes(3);
    });

    it('uses a different claim token per claim', async () => {
      const { publisher, outbox } = setup();
      outbox.claimNext.mockImplementation(() => Promise.resolve(claimed()));

      await publisher.processPendingBatch(2, { now: NOW });

      const tokens = outbox.claimNext.mock.calls.map(
        (call) => call[2] as string,
      );
      expect(new Set(tokens).size).toBe(2);
    });

    it('stops claiming when asked to stop', async () => {
      const { publisher, outbox } = setup();
      outbox.claimNext.mockImplementation(() => Promise.resolve(claimed()));
      let calls = 0;

      const result = await publisher.processPendingBatch(10, {
        now: NOW,
        shouldStop: () => ++calls > 2,
      });

      expect(result.claimed).toBe(2);
    });

    it('counts retries and failures separately', async () => {
      const { publisher, outbox, audit } = setup();
      outbox.claimNext
        .mockResolvedValueOnce(claimed({ eventId: 'e1' }))
        .mockResolvedValueOnce(claimed({ eventId: 'e2' }))
        .mockResolvedValue(null);
      audit.putIfNotExists
        .mockRejectedValueOnce(named('TimeoutError'))
        .mockRejectedValueOnce(conditionalFailure());
      audit.findExisting.mockResolvedValue({
        ...ValidationAuditRepository.buildItem(claimed({ eventId: 'e2' })),
        eventId: 'another-event',
      });

      const result = await publisher.processPendingBatch(10, { now: NOW });

      expect(result).toMatchObject({ retried: 1, failed: 1, published: 0 });
    });
  });

  describe('publishInline', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('does nothing when the event is not claimable', async () => {
      const { publisher, audit } = setup();

      await publisher.publishInline('missing');

      expect(audit.putIfNotExists).not.toHaveBeenCalled();
    });

    it('publishes the claimed event', async () => {
      const { publisher, outbox } = setup();
      outbox.claimById.mockResolvedValue(claimed());

      await publisher.publishInline('6f1c2b8e-0000-4000-8000-000000000001');

      expect(outbox.claimById).toHaveBeenCalledWith(
        '6f1c2b8e-0000-4000-8000-000000000001',
        expect.any(Date),
        60000,
        expect.any(String),
      );
      expect(outbox.markPublished).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'claim rejects',
        (o: ReturnType<typeof setup>) => {
          o.outbox.claimById.mockRejectedValue(named('MongoNetworkError'));
        },
      ],
      [
        'claim throws synchronously',
        (o: ReturnType<typeof setup>) => {
          o.outbox.claimById.mockImplementation(() => {
            throw named('MongoNetworkError');
          });
        },
      ],
      [
        'DynamoDB rejects',
        (o: ReturnType<typeof setup>) => {
          o.outbox.claimById.mockResolvedValue(claimed());
          o.audit.putIfNotExists.mockRejectedValue(named('TimeoutError'));
        },
      ],
    ])('never throws when %s', async (_label, arrange) => {
      const context = setup();
      arrange(context);

      await expect(context.publisher.publishInline('e')).resolves.toBe(
        undefined,
      );
    });

    it('returns within the budget when DynamoDB hangs and aborts the call', async () => {
      vi.useFakeTimers();
      const { publisher, outbox, audit } = setup({
        AUDIT_INLINE_TIMEOUT_MS: '200',
      });
      outbox.claimById.mockResolvedValue(claimed());
      let signal: AbortSignal | undefined;
      let rejectPut: (error: Error) => void = () => undefined;
      audit.putIfNotExists.mockImplementation(
        (_item: unknown, options: { abortSignal?: AbortSignal }) => {
          signal = options.abortSignal;
          return new Promise<void>((_resolve, reject) => {
            rejectPut = reject;
          });
        },
      );

      let settled = false;
      const inline = publisher.publishInline('e').then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(199);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await inline;

      expect(settled).toBe(true);
      expect(signal?.aborted).toBe(true);

      // The orphaned operation finishes later: it is ambiguous, so it only
      // schedules a retry with its own token and never publishes.
      rejectPut(named('AbortError'));
      await vi.advanceTimersByTimeAsync(0);
      expect(outbox.markPublished).not.toHaveBeenCalled();
      expect(outbox.markRetry).toHaveBeenCalledWith(
        expect.any(String),
        'token-1',
        expect.any(Date),
        'AUDIT_ABORTED',
        expect.any(Date),
      );
    });

    it('does not leak an unhandled rejection from an orphaned operation', async () => {
      vi.useFakeTimers();
      const { publisher, outbox } = setup({ AUDIT_INLINE_TIMEOUT_MS: '100' });
      let rejectClaim: (error: Error) => void = () => undefined;
      outbox.claimById.mockReturnValue(
        new Promise((_resolve, reject) => {
          rejectClaim = reject;
        }),
      );
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);

      const inline = publisher.publishInline('e');
      await vi.advanceTimersByTimeAsync(100);
      await inline;
      rejectClaim(named('MongoNetworkError'));
      await vi.advanceTimersByTimeAsync(10);
      process.off('unhandledRejection', unhandled);

      expect(unhandled).not.toHaveBeenCalled();
    });
  });

  describe('inline budget tied to the HTTP request', () => {
    const REQUEST_MS = 15000;
    const config = {
      REQUEST_TIMEOUT_MS: String(REQUEST_MS),
      AUDIT_INLINE_TIMEOUT_MS: '1500',
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('uses the full inline budget for a fresh request and outside a request', () => {
      const { publisher } = setup(config);
      const nowMs = Date.parse('2026-03-01T10:00:00.000Z');

      expect(publisher.inlineBudgetMs(new Date(nowMs - 100), nowMs)).toBe(1500);
      expect(publisher.inlineBudgetMs(undefined, nowMs)).toBe(1500);
    });

    it('shrinks to the time left minus the response margin', () => {
      const { publisher } = setup(config);
      const nowMs = Date.parse('2026-03-01T10:00:00.000Z');
      const elapsed = REQUEST_MS - RESPONSE_MARGIN_MS - 800;

      expect(publisher.inlineBudgetMs(new Date(nowMs - elapsed), nowMs)).toBe(
        800,
      );
    });

    it('is never longer than AUDIT_INLINE_TIMEOUT_MS and may be negative when exhausted', () => {
      const { publisher } = setup(config);
      const nowMs = Date.parse('2026-03-01T10:00:00.000Z');

      expect(publisher.inlineBudgetMs(new Date(nowMs), nowMs)).toBe(1500);
      expect(
        publisher.inlineBudgetMs(new Date(nowMs - REQUEST_MS), nowMs),
      ).toBeLessThan(0);
    });

    it('skips the inline attempt (no claim, no DynamoDB) when the request used almost all its time', async () => {
      const { publisher, outbox, audit } = setup(config);
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const startedAt = new Date(
        Date.now() -
          (REQUEST_MS - RESPONSE_MARGIN_MS - MIN_INLINE_BUDGET_MS + 1),
      );

      await publisher.publishInline('e1', startedAt);

      expect(outbox.claimById).not.toHaveBeenCalled();
      expect(audit.putIfNotExists).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipped'));
    });

    it('skips when the request already exceeded its timeout', async () => {
      const { publisher, outbox } = setup(config);
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await publisher.publishInline(
        'e1',
        new Date(Date.now() - REQUEST_MS * 2),
      );

      expect(outbox.claimById).not.toHaveBeenCalled();
    });

    it('still publishes when enough budget is left, with the shortened deadline', async () => {
      vi.useFakeTimers();
      const { publisher, outbox, audit } = setup(config);
      outbox.claimById.mockResolvedValue(claimed());
      let signal: AbortSignal | undefined;
      audit.putIfNotExists.mockImplementation(
        (_item: unknown, options: { abortSignal?: AbortSignal }) => {
          signal = options.abortSignal;
          return new Promise<void>(() => undefined); // never answers
        },
      );
      const startedAt = new Date(
        Date.now() - (REQUEST_MS - RESPONSE_MARGIN_MS - 300),
      );

      const inline = publisher.publishInline('e1', startedAt);
      await vi.advanceTimersByTimeAsync(299);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await inline;

      expect(signal?.aborted).toBe(true);
    });
  });

  describe('logging', () => {
    it('never logs the document number, partition keys or raw error messages', async () => {
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
        (level) =>
          vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
      );
      const { publisher, outbox, audit } = setup();
      audit.putIfNotExists
        .mockRejectedValueOnce(named('TimeoutError'))
        .mockRejectedValueOnce(named('ValidationException'))
        .mockRejectedValueOnce(conditionalFailure())
        .mockResolvedValue(undefined);
      audit.findExisting.mockResolvedValue({
        ...ValidationAuditRepository.buildItem(claimed()),
        eventId: 'other',
      });
      outbox.markPublished.mockRejectedValue(
        named('MongoError', `update failed for ${DOCUMENT}`),
      );

      for (let i = 0; i < 4; i++) {
        await publisher.publishClaimed(claimed(), NOW);
      }

      const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
      expect(logged).not.toContain(DOCUMENT);
      expect(logged).not.toContain('DOCUMENT#');
      expect(logged).toContain('6f1c2b8e-0000-4000-8000-000000000001');
      vi.restoreAllMocks();
    });
  });
});
