import type { IDynamoItem } from '../../database/dynamo/dynamo.repository.js';
import type { OutboxEventType } from './outbox-event.interface.js';

export const AUDIT_ITEM_SCHEMA_VERSION = 1;

/**
 * Immutable audit record stored in DynamoDB. The document number lives only in
 * the partition key; it is never duplicated as an attribute.
 */
export interface IValidationAuditItem extends IDynamoItem {
  readonly eventId: string;
  readonly validationId: string;
  readonly eventType: OutboxEventType;
  readonly countryCode: string;
  /** ISO-8601 UTC timestamp, equal to the validation creation time. */
  readonly createdAt: string;
  readonly schemaVersion: number;
}
