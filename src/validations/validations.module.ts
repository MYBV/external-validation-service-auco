import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CountriesModule } from '../countries/countries.module.js';
import { MongoModule } from '../database/mongo/mongo.module.js';
import { EnrichmentModule } from '../enrichment/enrichment.module.js';
import { ValidationsController } from './controllers/validations.controller.js';
import { ValidationRepository } from './repositories/validation.repository.js';
import { ValidationsService } from './services/validations.service.js';

/** Validation records with transactional outbox. Not global. */
@Module({
  imports: [MongoModule, CountriesModule, EnrichmentModule, AuditModule],
  controllers: [ValidationsController],
  providers: [ValidationRepository, ValidationsService],
})
export class ValidationsModule {}
