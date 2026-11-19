import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

/** True when a conditional write was rejected. The error is never altered. */
export function isConditionalCheckFailed(
  error: unknown,
): error is ConditionalCheckFailedException {
  return error instanceof ConditionalCheckFailedException;
}
