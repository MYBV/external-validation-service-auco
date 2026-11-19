import { randomUUID } from 'node:crypto';
import { DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import type { IAppConfig } from '../../src/config/configuration.js';
import type { DynamoService } from '../../src/database/dynamo/dynamo.service.js';
import { assertLocalDynamoEndpoint } from '../../src/database/init/infrastructure-guards.js';
import type { MongoService } from '../../src/database/mongo/mongo.service.js';
import { makeAppConfig } from './app-config.js';

/**
 * Every database and table created by an integration run starts with this
 * prefix; destructive helpers refuse any other name.
 */
export const TEST_RESOURCE_PREFIX = 'ev_test_';

export interface IIntegrationEnv {
  readonly config: IAppConfig;
  readonly resourceName: string;
}

function requireVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Integration tests need ${name} (see .env.example). They never fall back to defaults.`,
    );
  }
  return value;
}

export function newResourceName(): string {
  return `${TEST_RESOURCE_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

/**
 * Builds the configuration for one integration run. The DynamoDB endpoint must
 * be explicit and local, and the run only uses uniquely named resources, never
 * the application's database or table.
 */
export function loadIntegrationEnv(): IIntegrationEnv {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the process environment.
  }
  assertLocalDynamoEndpoint(process.env['DYNAMODB_ENDPOINT']);
  const resourceName = newResourceName();
  const config = makeAppConfig({
    NODE_ENV: 'test',
    MONGO_URI: requireVariable('MONGO_URI'),
    DYNAMODB_ENDPOINT: requireVariable('DYNAMODB_ENDPOINT'),
    AWS_ACCESS_KEY_ID: requireVariable('AWS_ACCESS_KEY_ID'),
    AWS_SECRET_ACCESS_KEY: requireVariable('AWS_SECRET_ACCESS_KEY'),
    MONGO_DB_NAME: resourceName,
    DYNAMODB_TABLE: resourceName,
  });
  return { config, resourceName };
}

function assertTestResource(name: string): void {
  if (!name.startsWith(TEST_RESOURCE_PREFIX)) {
    throw new Error(`Refusing to delete non-test resource "${name}"`);
  }
}

export async function dropTestDatabase(mongo: MongoService): Promise<void> {
  assertTestResource(mongo.db.databaseName);
  await mongo.db.dropDatabase();
}

export async function deleteTestTable(
  dynamo: DynamoService,
  tableName: string = dynamo.tableName,
): Promise<void> {
  assertTestResource(tableName);
  await dynamo.client.send(new DeleteTableCommand({ TableName: tableName }));
}
