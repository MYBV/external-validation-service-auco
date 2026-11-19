import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { makeAppConfig } from '../../test/support/app-config.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { APP_CONFIG } from '../config/configuration.js';
import { EnrichmentModule } from './enrichment.module.js';
import { RestCountriesService } from './services/rest-countries.service.js';

function commonStub(env: Record<string, string>) {
  @Global()
  @Module({
    providers: [
      { provide: APP_CONFIG, useValue: makeAppConfig(env) },
      RequestContextService,
    ],
    exports: [APP_CONFIG, RequestContextService],
  })
  class CommonStubModule {}
  return CommonStubModule;
}

describe('EnrichmentModule', () => {
  it('resolves RestCountriesService with HttpModule and the typed config', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        commonStub({ REST_COUNTRIES_API_KEY: 'k', HTTP_TIMEOUT_MS: '1234' }),
        EnrichmentModule,
      ],
    }).compile();

    expect(moduleRef.get(RestCountriesService)).toBeInstanceOf(
      RestCountriesService,
    );
  });

  it('fails to start without REST_COUNTRIES_API_KEY', async () => {
    await expect(
      Test.createTestingModule({
        imports: [commonStub({}), EnrichmentModule],
      }).compile(),
    ).rejects.toThrow(/REST_COUNTRIES_API_KEY/);
  });
});
