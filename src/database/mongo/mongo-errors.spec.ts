import { MongoError, MongoServerError } from 'mongodb';
import {
  isDuplicateKeyError,
  isDuplicateKeyOnIndex,
  isTransientMongoError,
  isUnknownCommitResult,
} from './mongo-errors.js';

const duplicate = (extra: Record<string, unknown> = {}) =>
  new MongoServerError({
    message: 'E11000 duplicate key',
    code: 11000,
    ...extra,
  });

describe('mongo error helpers', () => {
  it('detects duplicate key errors only', () => {
    expect(isDuplicateKeyError(duplicate())).toBe(true);
    expect(
      isDuplicateKeyError(new MongoServerError({ message: 'x', code: 13 })),
    ).toBe(false);
    expect(
      isDuplicateKeyError(
        new MongoServerError({ code: 112, message: 'WriteConflict' }),
      ),
    ).toBe(false);
    expect(isDuplicateKeyError(new Error('E11000 in plain Error'))).toBe(false);
    expect(isDuplicateKeyError({ code: 11000 })).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError(undefined)).toBe(false);
  });

  it('matches the index by key pattern when the server reports it', () => {
    const error = duplicate({ keyPattern: { idempotencyKey: 1 } });

    expect(isDuplicateKeyOnIndex(error, 'idx', 'idempotencyKey')).toBe(true);
    expect(
      isDuplicateKeyOnIndex(
        duplicate({ keyPattern: { eventId: 1 } }),
        'idx',
        'idempotencyKey',
      ),
    ).toBe(false);
  });

  it('falls back to the index name in the message', () => {
    const named = new MongoServerError({
      message: 'E11000 duplicate key error index: idx dup key',
      code: 11000,
    });

    expect(isDuplicateKeyOnIndex(named, 'idx', 'idempotencyKey')).toBe(true);
    expect(isDuplicateKeyOnIndex(duplicate(), 'idx', 'idempotencyKey')).toBe(
      false,
    );
    expect(isDuplicateKeyOnIndex(new Error('x'), 'idx', 'k')).toBe(false);
  });

  it('classifies transient errors by label or write conflict code', () => {
    const labelled = new MongoError('t');
    labelled.addErrorLabel('TransientTransactionError');
    const unknownCommit = new MongoError('u');
    unknownCommit.addErrorLabel('UnknownTransactionCommitResult');

    expect(isTransientMongoError(labelled)).toBe(true);
    expect(isTransientMongoError(unknownCommit)).toBe(true);
    expect(
      isTransientMongoError(new MongoServerError({ message: 'w', code: 112 })),
    ).toBe(true);
    expect(
      isTransientMongoError(new MongoServerError({ message: 'x', code: 13 })),
    ).toBe(false);
    expect(isTransientMongoError(duplicate())).toBe(false);
    expect(isTransientMongoError(new Error('plain'))).toBe(false);
  });

  it('detects an unknown commit result', () => {
    const unknownCommit = new MongoError('u');
    unknownCommit.addErrorLabel('UnknownTransactionCommitResult');

    expect(isUnknownCommitResult(unknownCommit)).toBe(true);
    expect(isUnknownCommitResult(new MongoError('x'))).toBe(false);
    expect(isUnknownCommitResult(new Error('x'))).toBe(false);
  });
});
