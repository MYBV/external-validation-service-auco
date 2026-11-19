import { Injectable } from '@nestjs/common';
import type { Filter, IndexDescription, ObjectId, WithId } from 'mongodb';
import { MongoRepository } from '../../database/mongo/mongo.repository.js';
import { MongoService } from '../../database/mongo/mongo.service.js';
import type { IOutboxEvent } from '../interfaces/outbox-event.interface.js';

export const AUDIT_OUTBOX_COLLECTION = 'audit_outbox';
export const OUTBOX_EVENT_ID_INDEX = 'eventId_unique';
export const OUTBOX_STATUS_INDEX = 'status_nextAttemptAt';

/**
 * Outbox persistence. Events are created inside the validation transaction and
 * then claimed, published and settled by the audit publisher.
 *
 * Lease protocol: claiming is a single atomic update that pushes
 * `nextAttemptAt` to `now + leaseMs`, stores a fresh `claimToken` and counts
 * the attempt. Transitions that depend on an attempt's own decision
 * (retry, failure) only match while that attempt still owns the token, so a
 * stale attempt can never overwrite the state of a newer claim.
 */
@Injectable()
export class OutboxRepository extends MongoRepository<IOutboxEvent> {
  protected override readonly indexes: readonly IndexDescription[] = [
    { key: { eventId: 1 }, name: OUTBOX_EVENT_ID_INDEX, unique: true },
    { key: { status: 1, nextAttemptAt: 1 }, name: OUTBOX_STATUS_INDEX },
  ];

  constructor(mongo: MongoService) {
    super(mongo, AUDIT_OUTBOX_COLLECTION);
  }

  /** Claims the oldest eligible PENDING event, or null when none is eligible. */
  claimNext(
    now: Date,
    leaseMs: number,
    token: string,
  ): Promise<WithId<IOutboxEvent> | null> {
    return this.claim({}, now, leaseMs, token);
  }

  /** Claims one specific event if it is eligible (never steals a live lease). */
  claimById(
    eventId: string,
    now: Date,
    leaseMs: number,
    token: string,
  ): Promise<WithId<IOutboxEvent> | null> {
    return this.claim({ eventId }, now, leaseMs, token);
  }

  /**
   * Settles an event as published. The caller must hold proof that the audit
   * record of exactly this event exists in DynamoDB; the filter binds the
   * transition to the event identity. The claim token is intentionally not
   * required: the evidence belongs to the event, not to the attempt.
   */
  async markPublished(
    eventId: string,
    validationId: ObjectId,
    now: Date,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      { eventId, validationId, status: 'PENDING' },
      {
        $set: { status: 'PUBLISHED', publishedAt: now },
        $unset: { claimToken: '', lastErrorCode: '', lastErrorAt: '' },
      },
    );
    return result.modifiedCount === 1;
  }

  /** Schedules the next attempt. Ignored unless the attempt still owns the claim. */
  async markRetry(
    eventId: string,
    token: string,
    nextAttemptAt: Date,
    errorCode: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      { eventId, status: 'PENDING', claimToken: token },
      {
        $set: { nextAttemptAt, lastErrorCode: errorCode, lastErrorAt: now },
        $unset: { claimToken: '' },
      },
    );
    return result.modifiedCount === 1;
  }

  /** Quarantines the event after a permanent error. Needs the claim as well. */
  async markFailed(
    eventId: string,
    token: string,
    errorCode: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      { eventId, status: 'PENDING', claimToken: token },
      {
        $set: {
          status: 'FAILED',
          failedAt: now,
          lastErrorCode: errorCode,
          lastErrorAt: now,
        },
        $unset: { claimToken: '' },
      },
    );
    return result.modifiedCount === 1;
  }

  private claim(
    extra: Filter<IOutboxEvent>,
    now: Date,
    leaseMs: number,
    token: string,
  ): Promise<WithId<IOutboxEvent> | null> {
    return this.collection.findOneAndUpdate(
      { ...extra, status: 'PENDING', nextAttemptAt: { $lte: now } },
      {
        $set: {
          nextAttemptAt: new Date(now.getTime() + leaseMs),
          claimToken: token,
          lastAttemptAt: now,
        },
        $inc: { attempts: 1 },
      },
      { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
    );
  }
}
