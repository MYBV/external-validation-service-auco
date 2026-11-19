import {
  Global,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  APP_CONFIG,
  buildAppConfig,
  CONFIG_MODULE_OPTIONS,
} from '../config/configuration.js';
import type { Env } from '../config/env.schema.js';
import { AllExceptionFilter } from './filters/all-exception.filter.js';
import { ApiKeyGuard } from './guards/api-key.guard.js';
import { ResponseInterceptor } from './interceptors/response.interceptor.js';
import { TimeOutInterceptor } from './interceptors/timeout.interceptor.js';
import { RequestContextMiddleware } from './middlewares/request-context.middleware.js';
import { RequestContextService } from './services/request-context.service.js';

/**
 * The only global module. ConfigModule is imported privately (not global) and
 * its validated values are exposed through the APP_CONFIG provider.
 */
@Global()
@Module({
  imports: [ConfigModule.forRoot(CONFIG_MODULE_OPTIONS)],
  providers: [
    {
      provide: APP_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildAppConfig({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          PORT: config.get('PORT', { infer: true }),
          API_KEY: config.get('API_KEY', { infer: true }),
          SWAGGER_ENABLED: config.get('SWAGGER_ENABLED', { infer: true }),
          REQUEST_TIMEOUT_MS: config.get('REQUEST_TIMEOUT_MS', {
            infer: true,
          }),
          MONGO_URI: config.get('MONGO_URI', { infer: true }),
          MONGO_DB_NAME: config.get('MONGO_DB_NAME', { infer: true }),
          MONGO_TIMEOUT_MS: config.get('MONGO_TIMEOUT_MS', { infer: true }),
          DYNAMODB_ENDPOINT: config.get('DYNAMODB_ENDPOINT', { infer: true }),
          DYNAMODB_TABLE: config.get('DYNAMODB_TABLE', { infer: true }),
          DYNAMODB_TIMEOUT_MS: config.get('DYNAMODB_TIMEOUT_MS', {
            infer: true,
          }),
          AWS_REGION: config.get('AWS_REGION', { infer: true }),
          AWS_ACCESS_KEY_ID: config.get('AWS_ACCESS_KEY_ID', { infer: true }),
          AWS_SECRET_ACCESS_KEY: config.get('AWS_SECRET_ACCESS_KEY', {
            infer: true,
          }),
          REST_COUNTRIES_BASE_URL: config.get('REST_COUNTRIES_BASE_URL', {
            infer: true,
          }),
          REST_COUNTRIES_API_KEY: config.get('REST_COUNTRIES_API_KEY', {
            infer: true,
          }),
          HTTP_TIMEOUT_MS: config.get('HTTP_TIMEOUT_MS', { infer: true }),
          IDEMPOTENCY_HASH_SECRET: config.get('IDEMPOTENCY_HASH_SECRET', {
            infer: true,
          }),
        }),
    },
    RequestContextService,
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_INTERCEPTOR, useClass: TimeOutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionFilter },
  ],
  exports: [APP_CONFIG, RequestContextService],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
