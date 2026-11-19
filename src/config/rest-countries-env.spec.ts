import { makeAppConfig } from '../../test/support/app-config.js';
import { validateEnv } from './env.schema.js';
import { DEFAULT_REST_COUNTRIES_BASE_URL } from './configuration.js';

const baseEnv = { API_KEY: 'k'.repeat(32) };

describe('REST Countries environment', () => {
  it('uses the v5 defaults when nothing is set', () => {
    const { restCountries } = makeAppConfig();

    expect(restCountries).toEqual({
      baseUrl: DEFAULT_REST_COUNTRIES_BASE_URL,
      apiKey: undefined,
      timeoutMs: 5000,
    });
    expect(DEFAULT_REST_COUNTRIES_BASE_URL).toBe(
      'https://api.restcountries.com/countries/v5',
    );
  });

  it('reads explicit values', () => {
    const { restCountries } = makeAppConfig({
      REST_COUNTRIES_BASE_URL: 'https://provider.test/v5',
      REST_COUNTRIES_API_KEY: 'secret-value',
      HTTP_TIMEOUT_MS: '1500',
    });

    expect(restCountries).toEqual({
      baseUrl: 'https://provider.test/v5',
      apiKey: 'secret-value',
      timeoutMs: 1500,
    });
  });

  it.each(['not-a-url', 'ftp://provider.test'])(
    'rejects the base URL %j without echoing it',
    (value) => {
      expect(() =>
        validateEnv({ ...baseEnv, REST_COUNTRIES_BASE_URL: value }),
      ).toThrow(/REST_COUNTRIES_BASE_URL/);
    },
  );

  it.each(['0', '-1', 'abc', '1.5'])('rejects HTTP_TIMEOUT_MS=%j', (value) => {
    expect(() => validateEnv({ ...baseEnv, HTTP_TIMEOUT_MS: value })).toThrow(
      /HTTP_TIMEOUT_MS/,
    );
  });
});
