import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { App } from 'supertest/types.js';

export const TEST_API_KEY = 'test-api-key-0123456789-abcdefghijklmnop';
export const TEST_IDEMPOTENCY_SECRET =
  'test-idempotency-secret-0123456789-abcdef';

const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  API_KEY: TEST_API_KEY,
  SWAGGER_ENABLED: 'false',
  REQUEST_TIMEOUT_MS: '100',
  // Dummy values: the e2e suite never connects to MongoDB nor calls the provider.
  MONGO_URI: 'mongodb://127.0.0.1:1',
  REST_COUNTRIES_API_KEY: 'test-rest-countries-key',
  IDEMPOTENCY_HASH_SECRET: TEST_IDEMPOTENCY_SECRET,
};

/** Application classes, imported after the environment is applied. */
export interface ITestAppClasses {
  readonly MongoService: typeof import('../../src/database/mongo/mongo.service.js').MongoService;
  readonly CountryRepository: typeof import('../../src/countries/repositories/country.repository.js').CountryRepository;
  readonly ValidationRepository: typeof import('../../src/validations/repositories/validation.repository.js').ValidationRepository;
  readonly OutboxRepository: typeof import('../../src/audit/repositories/outbox.repository.js').OutboxRepository;
  readonly RestCountriesService: typeof import('../../src/enrichment/services/rest-countries.service.js').RestCountriesService;
}

export interface ICreateTestAppOptions {
  /** Keeps the real MongoService (integration tests with a real replica set). */
  readonly realMongo?: boolean;
  /** Replaces providers (for example with in-memory fakes) before compiling. */
  readonly customize?: (
    builder: TestingModuleBuilder,
    classes: ITestAppClasses,
  ) => void;
}

/** MongoService stand-in: no connection; transactions just run the callback. */
const mongoStub = {
  client: {},
  db: { collection: () => ({}) },
  onModuleInit: (): Promise<void> => Promise.resolve(),
  onApplicationShutdown: (): Promise<void> => Promise.resolve(),
  withTransaction: <R>(work: (session: object) => Promise<R>): Promise<R> =>
    work({}),
};

/**
 * Builds the application with the same configureApp() used at runtime.
 *
 * ConfigModule.forRoot() validates the environment when the module graph is
 * evaluated, so the application modules are imported dynamically, after the
 * environment overrides are applied and with a fresh module registry. The
 * overrides are restored when the application is closed. MongoService is
 * always replaced by a stub: these tests never need a database.
 */
export async function createTestApp(
  overrides: Record<string, string> = {},
  options: ICreateTestAppOptions = {},
): Promise<INestApplication<App>> {
  const env = { ...BASE_ENV, ...overrides };
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  const restore = (): void => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  try {
    vi.resetModules();
    const { AppModule } = await import('../../src/app.module.js');
    const { configureApp } = await import('../../src/app.setup.js');
    const { TestController } = await import('./test.controller.js');
    const classes: ITestAppClasses = {
      MongoService: (await import('../../src/database/mongo/mongo.service.js'))
        .MongoService,
      CountryRepository: (
        await import('../../src/countries/repositories/country.repository.js')
      ).CountryRepository,
      ValidationRepository: (
        await import('../../src/validations/repositories/validation.repository.js')
      ).ValidationRepository,
      OutboxRepository: (
        await import('../../src/audit/repositories/outbox.repository.js')
      ).OutboxRepository,
      RestCountriesService: (
        await import('../../src/enrichment/services/rest-countries.service.js')
      ).RestCountriesService,
    };

    const builder = Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestController],
    });
    if (options.realMongo !== true) {
      builder.overrideProvider(classes.MongoService).useValue(mongoStub);
    }
    options.customize?.(builder, classes);
    const moduleRef = await builder.compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const close = app.close.bind(app);
    app.close = async () => {
      await close();
      restore();
    };
    return app;
  } catch (error) {
    restore();
    throw error;
  }
}
