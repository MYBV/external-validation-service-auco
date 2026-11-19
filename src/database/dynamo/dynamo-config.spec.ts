import { makeAppConfig } from '../../../test/support/app-config.js';
import { requireDynamoConfig } from './dynamo-config.js';

const local = {
  DYNAMODB_ENDPOINT: 'http://127.0.0.1:8001',
  AWS_ACCESS_KEY_ID: 'local',
  AWS_SECRET_ACCESS_KEY: 'local',
};

describe('requireDynamoConfig', () => {
  it('returns explicit credentials with the endpoint and defaults', () => {
    expect(requireDynamoConfig(makeAppConfig(local))).toEqual({
      endpoint: 'http://127.0.0.1:8001',
      table: 'validation_audit',
      region: 'us-east-1',
      timeoutMs: 2000,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    });
  });

  it.each(['development', 'test'])(
    'requires an endpoint when NODE_ENV is %s',
    (nodeEnv) => {
      expect(() =>
        requireDynamoConfig(makeAppConfig({ NODE_ENV: nodeEnv })),
      ).toThrow(/DYNAMODB_ENDPOINT/);
    },
  );

  it('allows the default AWS endpoint only in production', () => {
    const config = requireDynamoConfig(
      makeAppConfig({ NODE_ENV: 'production' }),
    );

    expect(config.endpoint).toBeUndefined();
    expect(config.credentials).toBeUndefined();
  });

  it.each(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'])(
    'requires explicit credentials with an endpoint (missing %s)',
    (missing) => {
      const env: Record<string, string> = { ...local };
      delete env[missing];

      expect(() => requireDynamoConfig(makeAppConfig(env))).toThrow(
        /AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY/,
      );
    },
  );

  it('keeps the default timeouts well below the request timeout', () => {
    const config = makeAppConfig(local);
    const { timeoutMs } = requireDynamoConfig(config);

    expect(config.mongo.timeoutMs).toBeLessThan(config.requestTimeoutMs);
    // Two attempts, each bounded by the timeout.
    expect(timeoutMs * 2).toBeLessThan(config.requestTimeoutMs);
  });
});
