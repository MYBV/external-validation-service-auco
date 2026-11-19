import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { APP_CONFIG, type IAppConfig } from '../config/configuration.js';
import { RestCountriesService } from './services/rest-countries.service.js';

/**
 * Geographic enrichment. Owns the HTTP client (no cross-cutting wrapper) and
 * is not global. APP_CONFIG and RequestContextService come from CommonModule.
 */
@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: IAppConfig) => ({
        timeout: config.restCountries.timeoutMs,
        maxRedirects: 0,
      }),
    }),
  ],
  providers: [RestCountriesService],
  exports: [RestCountriesService],
})
export class EnrichmentModule {}
