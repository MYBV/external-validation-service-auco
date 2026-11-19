import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';

export const TEST_API_KEY = 'test-api-key-0123456789-abcdefghijklmnop';

const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  API_KEY: TEST_API_KEY,
  SWAGGER_ENABLED: 'false',
  REQUEST_TIMEOUT_MS: '100',
};

/**
 * Builds the application with the same configureApp() used at runtime.
 *
 * ConfigModule.forRoot() validates the environment when the module graph is
 * evaluated, so the application modules are imported dynamically, after the
 * environment overrides are applied and with a fresh module registry. The
 * overrides are restored when the application is closed.
 */
export async function createTestApp(
  overrides: Record<string, string> = {},
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

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestController],
    }).compile();
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
