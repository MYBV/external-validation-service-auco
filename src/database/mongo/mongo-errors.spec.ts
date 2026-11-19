import { MongoServerError } from 'mongodb';
import { isDuplicateKeyError } from './mongo-errors.js';

describe('isDuplicateKeyError', () => {
  it('recognises E11000 server errors', () => {
    const error = new MongoServerError({ code: 11000, message: 'E11000 dup' });
    expect(isDuplicateKeyError(error)).toBe(true);
  });

  it.each([
    new MongoServerError({ code: 112, message: 'WriteConflict' }),
    new Error('E11000 in plain Error'),
    { code: 11000 },
    null,
    undefined,
  ])('ignores other values (%j)', (value) => {
    expect(isDuplicateKeyError(value)).toBe(false);
  });
});
