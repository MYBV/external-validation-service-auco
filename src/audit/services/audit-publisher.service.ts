import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WithId } from 'mongodb';
import { APP_CONFIG, type IAppConfig } from '../../config/configuration.js';
import { isConditionalCheckFailed } from '../../database/dynamo/dynamo-errors.js';
import { requireAuditConfig } from '../audit-config.js';
import {
  AUDIT_STATE_UPDATE_FAILED,
  AuditItemInvalidError,
  AuditItemMissingError,
  AuditKeyCollisionError,
  classifyAuditError,
} from '../audit-errors.js';
import type { IValidationAuditItem } from '../interfaces/audit-item.interface.js';
import type { IOutboxEvent } from '../interfaces/outbox-event.interface.js';
import { OutboxRepository } from '../repositories/outbox.repository.js';
import { ValidationAuditRepository } from '../repositories/validation-audit.repository.js';
import { computeBackoffMs } from '../utils/audit-backoff.util.js';

/**
 * published: DynamoDB persistence was proven and the outbox was settled.
 * retried / failed: the attempt ended in a transient / permanent error and the
 *   outbox was updated accordingly.
 * stale: another claim or publication already owns the event; nothing changed.
 * unsettled: the outcome could not be recorded in MongoDB; the event stays
 *   PENDING and its lease expiry makes it eligible again.
 */
export type AuditAttemptOutcome =
  'published' | 'retried' | 'failed' | 'stale' | 'unsettled';

/** Time reserved after the inline publication to finish and send the response. */
export const RESPONSE_MARGIN_MS = 500;
/** Below this remaining budget the inline attempt is skipped, not shortened. */
export const MIN_INLINE_BUDGET_MS = 100;

export interface IBatchResult {
  claimed: number;
  published: number;
  retried: number;
  failed: number;
  stale: number;
  unsettled: number;
}

export interface IBatchOptions {
  /** Clock for claim and backoff; defaults to the current time. */
  readonly now?: Date;
  /** Checked before every claim, so a stopping worker takes no new work. */
  readonly shouldStop?: () => boolean;
}

/**
 * Publishes outbox events to DynamoDB with at-least-once delivery and an
 * idempotent effect. The audit item is rebuilt from the outbox event on every
 * attempt, so keys and payload never change between retries. An event becomes
 * PUBLISHED only with proof that its own item exists in DynamoDB: a successful
 * conditional put, or an existing item whose full identity matches. Timeouts,
 * aborts and ambiguous acknowledgements are never proof.
 *
 * Logs contain event identifiers, counters and error names only.
 */
@Injectable()
export class AuditPublisher {
  private readonly logger = new Logger(AuditPublisher.name);
  private readonly leaseMs: number;
  private readonly inlineTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly backoffMaxMs: number;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly audit: ValidationAuditRepository,
    @Inject(APP_CONFIG) appConfig: IAppConfig,
  ) {
    const settings = requireAuditConfig(appConfig);
    this.leaseMs = settings.leaseMs;
    this.inlineTimeoutMs = settings.inlineTimeoutMs;
    this.requestTimeoutMs = appConfig.requestTimeoutMs;
    this.backoffMaxMs = settings.backoffMaxMs;
  }

  /**
   * Best-effort publication right after the MongoDB commit. It never throws
   * and never takes longer than the inline budget, whatever happens in
   * MongoDB or DynamoDB. When the budget expires the DynamoDB calls are
   * aborted, but MongoDB calls cannot be cancelled: the orphaned work may
   * finish later. That is safe because its transitions are fenced by the
   * claim token and `PUBLISHED` requires proof of persistence.
   */
  async publishInline(eventId: string, requestStartedAt?: Date): Promise<void> {
    const budgetMs = this.inlineBudgetMs(requestStartedAt);
    if (budgetMs < MIN_INLINE_BUDGET_MS) {
      this.logger.warn(
        `Inline audit publication of event ${eventId} skipped: the request has no time budget left; the recovery worker will publish it`,
      );
      return;
    }
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve();
      }, budgetMs);
    });
    const work = this.runInline(eventId, controller.signal).catch(
      (error: unknown) => {
        this.logger.warn(
          `Inline audit publication of event ${eventId} ended with ${classifyAuditError(error).code}`,
        );
      },
    );
    try {
      await Promise.race([work, budget]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Budget of the inline attempt: at most AUDIT_INLINE_TIMEOUT_MS and never
   * more than what is left of REQUEST_TIMEOUT_MS (measured from the start of
   * the HTTP request) minus a margin to finish and send the response. This
   * only limits the *new* work started after the commit: it does not cancel
   * a MongoDB transaction in progress and cannot prevent every timeout that
   * happens after the commit (the RxJS timeout does not cancel work either).
   */
  inlineBudgetMs(requestStartedAt?: Date, nowMs: number = Date.now()): number {
    if (requestStartedAt === undefined) {
      return this.inlineTimeoutMs;
    }
    const remaining =
      this.requestTimeoutMs -
      (nowMs - requestStartedAt.getTime()) -
      RESPONSE_MARGIN_MS;
    return Math.min(this.inlineTimeoutMs, remaining);
  }

  /**
   * Processes up to `limit` eligible events, one claim at a time so a lease
   * never expires while its event waits for its turn. Callable from tests.
   */
  async processPendingBatch(
    limit: number,
    options: IBatchOptions = {},
  ): Promise<IBatchResult> {
    const result: IBatchResult = {
      claimed: 0,
      published: 0,
      retried: 0,
      failed: 0,
      stale: 0,
      unsettled: 0,
    };
    while (result.claimed < limit && options.shouldStop?.() !== true) {
      const now = options.now ?? new Date();
      const event = await this.outbox.claimNext(
        now,
        this.leaseMs,
        randomUUID(),
      );
      if (event === null) {
        break;
      }
      result.claimed += 1;
      const outcome = await this.publishClaimed(event, now);
      result[outcome] += 1;
    }
    return result;
  }

  private async runInline(
    eventId: string,
    abortSignal: AbortSignal,
  ): Promise<void> {
    const now = new Date();
    const event = await this.outbox.claimById(
      eventId,
      now,
      this.leaseMs,
      randomUUID(),
    );
    if (event !== null) {
      await this.publishClaimed(event, now, abortSignal);
    }
  }

  /** One publication attempt for an event this caller has just claimed. */
  async publishClaimed(
    event: WithId<IOutboxEvent>,
    now: Date,
    abortSignal?: AbortSignal,
  ): Promise<AuditAttemptOutcome> {
    const token = event.claimToken;
    const attemptStartedMs = Date.now();
    try {
      await this.persist(this.buildItem(event), abortSignal);
    } catch (error: unknown) {
      // The next attempt is scheduled from the moment of the failure: `now`
      // (injectable in tests) plus the real time the attempt consumed.
      const failedAt = new Date(
        now.getTime() + (Date.now() - attemptStartedMs),
      );
      return this.settleFailure(event, token, failedAt, error);
    }

    // Proof of persistence obtained: settle the outbox.
    try {
      const updated = await this.outbox.markPublished(
        event.eventId,
        event.validationId,
        new Date(),
      );
      return updated ? 'published' : 'stale';
    } catch (error: unknown) {
      this.logger.warn(
        `Audit event ${event.eventId} is stored but the outbox update failed (${classifyAuditError(error).code}); it will be reconciled`,
      );
      return 'unsettled';
    }
  }

  private buildItem(event: IOutboxEvent): IValidationAuditItem {
    try {
      return ValidationAuditRepository.buildItem(event);
    } catch {
      throw new AuditItemInvalidError();
    }
  }

  /** Conditional put; a conditional failure is verified, never assumed. */
  private async persist(
    item: IValidationAuditItem,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    try {
      await this.audit.putIfNotExists(item, { abortSignal });
      return;
    } catch (error: unknown) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
    }
    const existing = await this.audit.findExisting(item, { abortSignal });
    if (existing === undefined) {
      throw new AuditItemMissingError();
    }
    if (!ValidationAuditRepository.isSameEvent(existing, item)) {
      throw new AuditKeyCollisionError();
    }
    // Same identity: the event was already stored (a valid replay).
  }

  private async settleFailure(
    event: WithId<IOutboxEvent>,
    token: string | undefined,
    failedAt: Date,
    error: unknown,
  ): Promise<AuditAttemptOutcome> {
    const { kind, code } = classifyAuditError(error);
    if (token === undefined) {
      return 'stale';
    }
    try {
      if (kind === 'permanent') {
        this.logger.error(
          `Audit event ${event.eventId} failed permanently: ${code}`,
        );
        const updated = await this.outbox.markFailed(
          event.eventId,
          token,
          code,
          new Date(),
        );
        return updated ? 'failed' : 'stale';
      }
      const delayMs = computeBackoffMs(event.attempts, this.backoffMaxMs);
      this.logger.warn(
        `Audit event ${event.eventId} attempt ${event.attempts} failed (${code}); retrying in ${delayMs} ms`,
      );
      const updated = await this.outbox.markRetry(
        event.eventId,
        token,
        new Date(failedAt.getTime() + delayMs),
        code,
        new Date(),
      );
      return updated ? 'retried' : 'stale';
    } catch (updateError: unknown) {
      this.logger.warn(
        `Audit event ${event.eventId}: ${AUDIT_STATE_UPDATE_FAILED} (${classifyAuditError(updateError).code}); the lease will expire`,
      );
      return 'unsettled';
    }
  }
}
