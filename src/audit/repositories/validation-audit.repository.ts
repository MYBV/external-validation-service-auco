import { Injectable } from '@nestjs/common';
import {
  DynamoRepository,
  type IDynamoCallOptions,
} from '../../database/dynamo/dynamo.repository.js';
import { DynamoService } from '../../database/dynamo/dynamo.service.js';
import {
  AUDIT_ITEM_SCHEMA_VERSION,
  type IValidationAuditItem,
} from '../interfaces/audit-item.interface.js';
import type { IOutboxEvent } from '../interfaces/outbox-event.interface.js';

export interface IAuditKeys {
  readonly pk: string;
  readonly sk: string;
}

/**
 * Single place that builds the audit keys (D-09, country-scoped variant):
 * - PK groups every event of one document of one country, so equal numbers in
 *   different countries never share a history. The country code has a fixed
 *   width of two letters, so the key is unambiguous.
 * - SK is a fixed-width ISO UTC timestamp (lexicographic order equals
 *   chronological order) plus the stable event id, which breaks ties within
 *   the same millisecond and makes every retry write the very same key.
 */
export function buildAuditKeys(
  countryCode: string,
  documentNumber: string,
  occurredAt: Date,
  eventId: string,
): IAuditKeys {
  return {
    pk: buildAuditPartitionKey(countryCode, documentNumber),
    sk: `${occurredAt.toISOString()}#${eventId}`,
  };
}

export function buildAuditPartitionKey(
  countryCode: string,
  documentNumber: string,
): string {
  return `DOCUMENT#${countryCode}#${documentNumber}`;
}

/** Attributes that define the identity of an event besides its keys. */
const IDENTITY_FIELDS = [
  'PK',
  'SK',
  'eventId',
  'validationId',
  'eventType',
  'countryCode',
  'createdAt',
  'schemaVersion',
] as const satisfies ReadonlyArray<keyof IValidationAuditItem>;

/**
 * Audit trail persistence in DynamoDB. Items are immutable: the only write is
 * the conditional put inherited from the base class.
 */
@Injectable()
export class ValidationAuditRepository extends DynamoRepository<IValidationAuditItem> {
  constructor(dynamo: DynamoService) {
    super(dynamo);
  }

  /** Pure and deterministic: the same outbox event always yields the same item. */
  static buildItem(event: IOutboxEvent): IValidationAuditItem {
    const { pk, sk } = buildAuditKeys(
      event.countryCode,
      event.documentNumber,
      event.occurredAt,
      event.eventId,
    );
    return {
      PK: pk,
      SK: sk,
      eventId: event.eventId,
      validationId: event.validationId.toHexString(),
      eventType: event.eventType,
      countryCode: event.countryCode,
      createdAt: event.occurredAt.toISOString(),
      schemaVersion: AUDIT_ITEM_SCHEMA_VERSION,
    };
  }

  /**
   * True only when the stored item has exactly the identity of the expected
   * one. A conditional failure alone proves nothing: it may be another event.
   */
  static isSameEvent(
    existing: IValidationAuditItem,
    expected: IValidationAuditItem,
  ): boolean {
    return IDENTITY_FIELDS.every(
      (field) => existing[field] === expected[field],
    );
  }

  findExisting(
    item: IValidationAuditItem,
    options?: IDynamoCallOptions,
  ): Promise<IValidationAuditItem | undefined> {
    return this.getByKey(item.PK, item.SK, options);
  }

  /** Chronological history of one document (used by tests and future reads). */
  listByDocument(
    countryCode: string,
    documentNumber: string,
    limit?: number,
  ): Promise<IValidationAuditItem[]> {
    return this.queryByPartition(
      buildAuditPartitionKey(countryCode, documentNumber),
      { limit },
    );
  }
}
