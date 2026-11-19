import { MongoServerError } from 'mongodb';

const DUPLICATE_KEY_CODE = 11000;

/** True for unique index violations (E11000). The error itself is never altered. */
export function isDuplicateKeyError(error: unknown): error is MongoServerError {
  return error instanceof MongoServerError && error.code === DUPLICATE_KEY_CODE;
}
