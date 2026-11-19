import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

/** Stable codes stored in the outbox (`lastErrorCode`); never raw messages. */
export const AUDIT_KEY_COLLISION = 'AUDIT_KEY_COLLISION';
export const AUDIT_ITEM_MISSING = 'AUDIT_ITEM_MISSING';
export const AUDIT_ITEM_INVALID = 'AUDIT_ITEM_INVALID';
export const AUDIT_STATE_UPDATE_FAILED = 'AUDIT_STATE_UPDATE_FAILED';
export const AUDIT_ABORTED = 'AUDIT_ABORTED';
export const AUDIT_UNKNOWN_ERROR = 'AUDIT_UNKNOWN_ERROR';

export type AuditErrorKind = 'transient' | 'permanent';

export interface IClassifiedAuditError {
  readonly kind: AuditErrorKind;
  /** Error name or stable code. Safe to log and to persist. */
  readonly code: string;
}

/** Thrown by the publisher when the existing item belongs to another event. */
export class AuditKeyCollisionError extends Error {
  constructor() {
    super('Audit key collision with a different event');
    this.name = AUDIT_KEY_COLLISION;
  }
}

/** Thrown when a conditional failure cannot be verified (item not readable). */
export class AuditItemMissingError extends Error {
  constructor() {
    super('Conditional write failed but the existing item was not found');
    this.name = AUDIT_ITEM_MISSING;
  }
}

/** Thrown when the outbox event cannot be turned into an audit item. */
export class AuditItemInvalidError extends Error {
  constructor() {
    super('Outbox event cannot be transformed into an audit item');
    this.name = AUDIT_ITEM_INVALID;
  }
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name !== '') {
    return error.name;
  }
  return AUDIT_UNKNOWN_ERROR;
}

/**
 * Classifies a failure of one publication attempt. Only two situations are
 * permanent: a real identity collision and an outbox event that cannot be
 * turned into an audit item. Everything else is transient, including every
 * error DynamoDB returns (ValidationException included): invalid table names,
 * credentials or a missing table are operational problems an operator can fix,
 * and the audit item has a small fixed shape that DynamoDB cannot reject on
 * its own merits. Quarantining those events would lose audit data for a
 * configuration mistake.
 */
export function classifyAuditError(error: unknown): IClassifiedAuditError {
  if (error instanceof AuditKeyCollisionError) {
    return { kind: 'permanent', code: AUDIT_KEY_COLLISION };
  }
  if (error instanceof AuditItemInvalidError) {
    return { kind: 'permanent', code: AUDIT_ITEM_INVALID };
  }
  if (error instanceof AuditItemMissingError) {
    return { kind: 'transient', code: AUDIT_ITEM_MISSING };
  }
  if (error instanceof ConditionalCheckFailedException) {
    return { kind: 'transient', code: 'ConditionalCheckFailedException' };
  }
  const name = errorName(error);
  if (name === 'AbortError') {
    return { kind: 'transient', code: AUDIT_ABORTED };
  }
  return { kind: 'transient', code: name };
}
