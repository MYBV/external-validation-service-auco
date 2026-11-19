import { Module } from '@nestjs/common';
import { MongoModule } from '../database/mongo/mongo.module.js';
import { CountryRepository } from './repositories/country.repository.js';
import { CountriesService } from './services/countries.service.js';

/** Local countries catalog. Not global; imported by the domain modules that need it. */
@Module({
  imports: [MongoModule],
  providers: [CountryRepository, CountriesService],
  exports: [CountriesService],
})
export class CountriesModule {}
