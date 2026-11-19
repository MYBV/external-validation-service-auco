import type { LoggerService } from '@nestjs/common';
import { CountryRepository } from '../../countries/repositories/country.repository.js';
import { CountriesService } from '../../countries/services/countries.service.js';
import { ensureTable } from '../dynamo/dynamo-table.js';
import type { DynamoService } from '../dynamo/dynamo.service.js';
import type { MongoService } from '../mongo/mongo.service.js';
import { initializeMongo } from './initialize-mongo.js';

/**
 * Local infrastructure initialisation: replica set check, indexes and seed in
 * MongoDB, and the DynamoDB table. Safe to repeat: it never deletes or
 * recreates anything. It has no side effects on import and always releases
 * both clients, so it can be called from tests with real or fake services.
 * The executable entry point is init-infrastructure.ts.
 */
export async function initializeInfrastructure(
  mongo: MongoService,
  dynamo: DynamoService,
  logger: Pick<LoggerService, 'log'>,
): Promise<void> {
  try {
    await mongo.onModuleInit();
    // Each stage registers its concrete repositories in this list.
    const countries = new CountryRepository(mongo);
    await initializeMongo(mongo, [countries]);
    logger.log('MongoDB: replica set primary verified, indexes ensured');

    const inserted = await new CountriesService(countries).seed();
    logger.log(`MongoDB: countries seed inserted ${inserted} new entries`);

    const outcome = await ensureTable(dynamo.client, dynamo.tableName);
    logger.log(`DynamoDB: table "${dynamo.tableName}" ${outcome}`);
  } finally {
    await mongo.onApplicationShutdown();
    dynamo.onApplicationShutdown();
  }
}
