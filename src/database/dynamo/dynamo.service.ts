import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type IAppConfig } from '../../config/configuration.js';
import { requireDynamoConfig } from './dynamo-config.js';

/** Total attempts per command (1 try + 1 retry) to bound latency. */
const MAX_ATTEMPTS = 2;

/**
 * Owns the DynamoDB clients of the process. Clients are lazy: nothing is
 * contacted at startup, so an unavailable DynamoDB never blocks the API
 * (audit delivery is eventual, D-10). It can also be constructed manually by
 * scripts and tests.
 */
@Injectable()
export class DynamoService implements OnApplicationShutdown {
  readonly client: DynamoDBClient;
  readonly documentClient: DynamoDBDocumentClient;
  readonly tableName: string;

  constructor(@Inject(APP_CONFIG) appConfig: IAppConfig) {
    const config = requireDynamoConfig(appConfig);
    this.tableName = config.table;
    this.client = new DynamoDBClient({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.credentials,
      maxAttempts: MAX_ATTEMPTS,
      requestHandler: {
        requestTimeout: config.timeoutMs,
        connectionTimeout: config.timeoutMs,
      },
    });
    this.documentClient = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
