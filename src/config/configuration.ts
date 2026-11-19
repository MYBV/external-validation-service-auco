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

/** Raw MongoDB settings; `uri` is enforced by the MongoDB module. */
export interface IMongoSettings {
  readonly uri?: string;
  readonly dbName: string;
  readonly timeoutMs: number;
}

/** Raw DynamoDB settings; endpoint and credentials are enforced by DynamoModule. */
export interface IDynamoSettings {
  readonly endpoint?: string;
  readonly table: string;
  readonly region: string;
  readonly timeoutMs: number;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
}

export const DEFAULT_REST_COUNTRIES_BASE_URL =
  'https://api.restcountries.com/countries/v5';

/** Raw REST Countries settings; the API key is enforced by the enrichment module. */
export interface IRestCountriesSettings {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeoutMs: number;
}

export interface IAppConfig {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly port: number;
  readonly apiKey: string;
  readonly swaggerEnabled: boolean;
  readonly requestTimeoutMs: number;
  readonly mongo: IMongoSettings;
  readonly dynamo: IDynamoSettings;
  readonly restCountries: IRestCountriesSettings;
}

export function buildAppConfig(env: Env): IAppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    apiKey: env.API_KEY,
    swaggerEnabled: env.SWAGGER_ENABLED,
    requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
    mongo: {
      uri: env.MONGO_URI,
      dbName: env.MONGO_DB_NAME,
      timeoutMs: env.MONGO_TIMEOUT_MS,
    },
    dynamo: {
      endpoint: env.DYNAMODB_ENDPOINT,
      table: env.DYNAMODB_TABLE,
      region: env.AWS_REGION,
      timeoutMs: env.DYNAMODB_TIMEOUT_MS,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
    restCountries: {
      baseUrl: env.REST_COUNTRIES_BASE_URL ?? DEFAULT_REST_COUNTRIES_BASE_URL,
      apiKey: env.REST_COUNTRIES_API_KEY,
      timeoutMs: env.HTTP_TIMEOUT_MS,
    },
  };
}
