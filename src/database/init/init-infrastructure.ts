import { Logger } from '@nestjs/common';
import { buildAppConfig } from '../../config/configuration.js';
import { validateEnv } from '../../config/env.schema.js';
import { ensureTable } from '../dynamo/dynamo-table.js';
import { DynamoService } from '../dynamo/dynamo.service.js';
import { MongoService } from '../mongo/mongo.service.js';
import { assertLocalDynamoEndpoint } from './infrastructure-guards.js';
import {
  type IIndexedRepository,
  initializeMongo,
} from './initialize-mongo.js';

/**
 * Repositories whose indexes this procedure ensures. Empty in Stage 2; each
 * later stage registers its concrete repositories here.
 */
function indexedRepositories(_mongo: MongoService): IIndexedRepository[] {
  return [];
}

/**
 * Local infrastructure initialisation (`npm run infra:init`). Safe to repeat:
 * it never deletes or recreates anything.
 */
async function main(): Promise<void> {
  const logger = new Logger('InfrastructureInit');
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the process environment.
  }

  const config = buildAppConfig(validateEnv(process.env));
  assertLocalDynamoEndpoint(config.dynamo.endpoint);

  const mongo = new MongoService(config);
  const dynamo = new DynamoService(config);
  try {
    await mongo.onModuleInit();
    await initializeMongo(mongo, indexedRepositories(mongo));
    logger.log('MongoDB: replica set primary verified, indexes ensured');

    const outcome = await ensureTable(dynamo.client, dynamo.tableName);
    logger.log(`DynamoDB: table "${dynamo.tableName}" ${outcome}`);
  } finally {
    await mongo.onApplicationShutdown();
    dynamo.onApplicationShutdown();
  }
}

try {
  await main();
} catch (error: unknown) {
  new Logger('InfrastructureInit').error(
    error instanceof Error ? error.message : 'Infrastructure init failed',
  );
  process.exitCode = 1;
}
