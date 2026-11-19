import type { IAppConfig } from '../../config/configuration.js';

export interface IMongoConfig {
  readonly uri: string;
  readonly dbName: string;
  readonly timeoutMs: number;
}

/**
 * Returns the MongoDB settings, failing with a readable error when the
 * variables this infrastructure needs are missing. The base schema keeps them
 * optional so HTTP-only code paths never depend on MongoDB.
 */
export function requireMongoConfig(config: IAppConfig): IMongoConfig {
  const { uri, dbName, timeoutMs } = config.mongo;
  if (uri === undefined) {
    throw new Error('MongoDB infrastructure requires MONGO_URI to be set');
  }
  return { uri, dbName, timeoutMs };
}
