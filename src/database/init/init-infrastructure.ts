import { Logger } from '@nestjs/common';
import { buildAppConfig } from '../../config/configuration.js';
import { validateEnv } from '../../config/env.schema.js';
import { DynamoService } from '../dynamo/dynamo.service.js';
import { MongoService } from '../mongo/mongo.service.js';
import { assertLocalDynamoEndpoint } from './infrastructure-guards.js';
import { initializeInfrastructure } from './initialize-infrastructure.js';

/**
 * Executable entry point of `npm run infra:init`. It only loads the
 * environment, applies the local-endpoint guard and delegates to
 * initializeInfrastructure(), which holds the testable logic.
 */
async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the process environment.
  }

  const config = buildAppConfig(validateEnv(process.env));
  assertLocalDynamoEndpoint(config.dynamo.endpoint);

  await initializeInfrastructure(
    new MongoService(config),
    new DynamoService(config),
    new Logger('InfrastructureInit'),
  );
}

try {
  await main();
} catch (error: unknown) {
  new Logger('InfrastructureInit').error(
    error instanceof Error ? error.message : 'Infrastructure init failed',
  );
  process.exitCode = 1;
}
