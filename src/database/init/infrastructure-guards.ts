const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set([
  '127.0.0.1',
  'localhost',
  '[::1]',
]);

/**
 * Safety guard for the initialisation script and the integration tests: they
 * may only talk to a DynamoDB Local endpoint that is set explicitly and that
 * points at this machine. A missing variable or a remote host aborts instead
 * of falling back to a real AWS account. There is no bypass.
 */
export function assertLocalDynamoEndpoint(
  endpoint: string | undefined,
): string {
  if (endpoint === undefined || endpoint.trim() === '') {
    throw new Error(
      'DYNAMODB_ENDPOINT must be set explicitly to a DynamoDB Local endpoint',
    );
  }
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname;
  } catch {
    throw new Error('DYNAMODB_ENDPOINT is not a valid URL');
  }
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    throw new Error(
      'DYNAMODB_ENDPOINT must point to localhost, 127.0.0.1 or [::1]; refusing to use a remote endpoint',
    );
  }
  return endpoint;
}
