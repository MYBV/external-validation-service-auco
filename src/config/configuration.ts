import type { ConfigModuleOptions } from '@nestjs/config';
import { type Env, validateEnv } from './env.schema.js';

/**
 * Single source of the ConfigModule options, shared by CommonModule and the
 * tests so both validate the environment exactly the same way.
 */
export const CONFIG_MODULE_OPTIONS: ConfigModuleOptions = {
  isGlobal: false,
  validate: validateEnv,
};

/** Injection token for the typed, validated application configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export interface IAppConfig {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly port: number;
  readonly apiKey: string;
  readonly swaggerEnabled: boolean;
  readonly requestTimeoutMs: number;
}

export function buildAppConfig(env: Env): IAppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    apiKey: env.API_KEY,
    swaggerEnabled: env.SWAGGER_ENABLED,
    requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
  };
}
