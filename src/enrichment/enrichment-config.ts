import type { IAppConfig } from '../config/configuration.js';

export interface IRestCountriesConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
}

/**
 * Returns the REST Countries settings, failing with a readable error when the
 * provider key is missing. The base schema keeps it optional so HTTP-only code
 * paths never depend on the provider. The error never includes the key.
 */
export function requireRestCountriesConfig(
  config: IAppConfig,
): IRestCountriesConfig {
  const { baseUrl, apiKey, timeoutMs } = config.restCountries;
  if (apiKey === undefined) {
    throw new Error(
      'REST Countries enrichment requires REST_COUNTRIES_API_KEY to be set',
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, timeoutMs };
}
