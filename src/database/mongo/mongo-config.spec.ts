import { makeAppConfig } from '../../../test/support/app-config.js';
import { requireMongoConfig } from './mongo-config.js';

describe('requireMongoConfig', () => {
  it('returns the settings with their defaults', () => {
    const config = makeAppConfig({ MONGO_URI: 'mongodb://127.0.0.1:27018' });

    expect(requireMongoConfig(config)).toEqual({
      uri: 'mongodb://127.0.0.1:27018',
      dbName: 'external_validation',
      timeoutMs: 5000,
    });
  });

  it('fails with a readable error when MONGO_URI is missing', () => {
    expect(() => requireMongoConfig(makeAppConfig())).toThrow(/MONGO_URI/);
  });
});
