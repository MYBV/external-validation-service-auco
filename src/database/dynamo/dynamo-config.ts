import type { IAppConfig } from '../../config/configuration.js';

export interface IDynamoConfig {
  readonly endpoint?: string;
  readonly table: string;
  readonly region: string;
  readonly timeoutMs: number;
  /** Present whenever an endpoint is set: the ambient AWS chain is not used. */
  readonly credentials?: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
}

/**
 * Returns the DynamoDB settings, failing with a readable error when they are
 * unsafe or incomplete:
 * - Outside production an explicit endpoint is mandatory, so a missing
 *   variable can never send writes to a real AWS account.
 * - With an endpoint, explicit credentials are mandatory so ambient AWS
 *   credentials are never picked up.
 */
export function requireDynamoConfig(config: IAppConfig): IDynamoConfig {
  const { endpoint, table, region, timeoutMs, accessKeyId, secretAccessKey } =
    config.dynamo;

  if (endpoint === undefined) {
    if (config.nodeEnv !== 'production') {
      throw new Error(
        'DynamoDB infrastructure requires DYNAMODB_ENDPOINT outside production',
      );
    }
    return { table, region, timeoutMs };
  }

  if (accessKeyId === undefined || secretAccessKey === undefined) {
    throw new Error(
      'DynamoDB infrastructure requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY when DYNAMODB_ENDPOINT is set',
    );
  }
  return {
    endpoint,
    table,
    region,
    timeoutMs,
    credentials: { accessKeyId, secretAccessKey },
  };
}
