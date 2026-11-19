import { MongoError, MongoServerError } from 'mongodb';

const DUPLICATE_KEY_CODE = 11000;
const WRITE_CONFLICT_CODE = 112;

/** True for unique index violations (E11000). The error itself is never altered. */
export function isDuplicateKeyError(error: unknown): error is MongoServerError {
  return error instanceof MongoServerError && error.code === DUPLICATE_KEY_CODE;
}

/**
 * True for an E11000 raised by the named unique index. Matches the index name
 * in the message or, when the server reports it, the key pattern fields.
 */
export function isDuplicateKeyOnIndex(
  error: unknown,
  indexName: string,
  keyField: string,
): boolean {
  if (!isDuplicateKeyError(error)) {
    return false;
  }
  const keyPattern: unknown = error.keyPattern;
  if (typeof keyPattern === 'object' && keyPattern !== null) {
    return keyField in keyPattern;
  }
  return error.message.includes(indexName);
}

/**
 * True for errors a transaction may succeed after retrying: transient
 * transaction errors, an unknown commit result or a write conflict. Any other
 * error (including other server errors) is not transient.
 */
export function isTransientMongoError(error: unknown): boolean {
  if (!(error instanceof MongoError)) {
    return false;
  }
  if (
    error.hasErrorLabel('TransientTransactionError') ||
    error.hasErrorLabel('UnknownTransactionCommitResult')
  ) {
    return true;
  }
  return (
    error instanceof MongoServerError && error.code === WRITE_CONFLICT_CODE
  );
}

/** True when the commit outcome is unknown (the transaction may have been applied). */
export function isUnknownCommitResult(error: unknown): boolean {
  return (
    error instanceof MongoError &&
    error.hasErrorLabel('UnknownTransactionCommitResult')
  );
}
