import type { ObjectId } from 'mongodb';

export type OutboxEventType = 'VALIDATION_CREATED';

export type OutboxEventStatus = 'PENDING' | 'PUBLISHED';

/**
 * Audit event persisted together with the validation. It holds enough data to
 * publish an identical audit record later (Stage 5). `documentNumber` is
 * sensitive: never log this document.
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
}
