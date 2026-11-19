import {
  ConditionalCheckFailedException,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import { isConditionalCheckFailed } from './dynamo-errors.js';

describe('isConditionalCheckFailed', () => {
  it('recognises rejected conditional writes', () => {
    const error = new ConditionalCheckFailedException({
      message: 'conditional',
      $metadata: {},
    });
    expect(isConditionalCheckFailed(error)).toBe(true);
  });

  it.each([
    new ResourceNotFoundException({ message: 'other', $metadata: {} }),
    new Error('ConditionalCheckFailedException'),
    null,
  ])('ignores other values (%j)', (value) => {
    expect(isConditionalCheckFailed(value)).toBe(false);
  });
});
