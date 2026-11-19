import type { ObjectId } from 'mongodb';

export type OutboxEventType = 'VALIDATION_CREATED';

/**
 * PENDING: waiting for publication (it may hold a lease, see below).
 * PUBLISHED: terminal, DynamoDB persistence was proven.
 * FAILED: terminal, a permanent error was detected; kept for inspection and
 * never retried automatically.
 */
export type OutboxEventStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';

/**
 * Audit event persisted together with the validation. It holds enough data to
 * rebuild an identical audit record on every retry. `documentNumber` is
 * sensitive: never log this document.
 *
 * Lease: claiming an event pushes `nextAttemptAt` into the future and stores a
 * fresh `claimToken`. There is no separate lease field; an expired lease is
 * simply an event whose `nextAttemptAt` has elapsed again.
 */
export interface IOutboxEvent {
  eventId: string;
  validationId: ObjectId;
  eventType: OutboxEventType;
  documentNumber: string;
  countryCode: string;
  occurredAt: Date;
  status: OutboxEventStatus;
  attempts: number;
  nextAttemptAt: Date;
  publishedAt?: Date;
  claimToken?: string;
  lastAttemptAt?: Date;
  /** Error name/code only: never messages, which may carry sensitive data. */
  lastErrorCode?: string;
  lastErrorAt?: Date;
  failedAt?: Date;
}
