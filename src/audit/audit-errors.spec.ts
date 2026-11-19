import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  AUDIT_ABORTED,
  AUDIT_ITEM_INVALID,
  AUDIT_ITEM_MISSING,
  AUDIT_KEY_COLLISION,
  AuditItemInvalidError,
  AuditItemMissingError,
  AuditKeyCollisionError,
  classifyAuditError,
} from './audit-errors.js';

function named(name: string): Error {
  const error = new Error('message with 1020304050');
  error.name = name;
  return error;
}

describe('classifyAuditError', () => {
  it('treats identity collisions and invalid items as permanent', () => {
    expect(classifyAuditError(new AuditKeyCollisionError())).toEqual({
      kind: 'permanent',
      code: AUDIT_KEY_COLLISION,
    });
    expect(classifyAuditError(new AuditItemInvalidError())).toEqual({
      kind: 'permanent',
      code: AUDIT_ITEM_INVALID,
    });
  });

  it.each([
    'ValidationException',
    'ItemCollectionSizeLimitExceededException',
    'TimeoutError',
    'ProvisionedThroughputExceededException',
    'ThrottlingException',
    'ResourceNotFoundException',
    'UnrecognizedClientException',
    'AccessDeniedException',
    'InternalServerError',
    'ECONNREFUSED',
  ])('treats %s as transient', (name) => {
    expect(classifyAuditError(named(name))).toEqual({
      kind: 'transient',
      code: name,
    });
  });

  it('treats a missing existing item, aborts and unknown values as transient', () => {
    expect(classifyAuditError(new AuditItemMissingError())).toEqual({
      kind: 'transient',
      code: AUDIT_ITEM_MISSING,
    });
    expect(classifyAuditError(named('AbortError'))).toEqual({
      kind: 'transient',
      code: AUDIT_ABORTED,
    });
    expect(classifyAuditError('boom').kind).toBe('transient');
    expect(classifyAuditError(undefined).kind).toBe('transient');
  });

  it('never returns the raw message (it may contain sensitive data)', () => {
    const classified = classifyAuditError(named('SomeError'));
    expect(JSON.stringify(classified)).not.toContain('1020304050');
  });

  it('does not treat a bare conditional failure as success', () => {
    const error = new ConditionalCheckFailedException({
      message: 'exists',
      $metadata: {},
    });
    expect(classifyAuditError(error).kind).toBe('transient');
  });
});
