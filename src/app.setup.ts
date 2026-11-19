import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { APP_CONFIG, type IAppConfig } from './config/configuration.js';
import { setupSwagger } from './swagger-conf.js';

/**
 * HTTP configuration shared by the runtime and the e2e tests. The guard,
 * interceptors, filter and request-context middleware are registered by
 * CommonModule; no global prefix or versioning is applied.
 */
export function configureApp(app: INestApplication): void {
  // Do not advertise the framework in responses.
  // getInstance() is untyped; the project always runs on the Express adapter.
  (app.getHttpAdapter().getInstance() as Express).disable('x-powered-by');

  // Lets providers (database clients) run their onApplicationShutdown hooks
  // when the process receives SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const config = app.get<IAppConfig>(APP_CONFIG);
  if (config.swaggerEnabled) {
    setupSwagger(app);
  }
}
