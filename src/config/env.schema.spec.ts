import { validateEnv } from './env.schema.js';

const validEnv = { API_KEY: 'k'.repeat(32) };

describe('validateEnv', () => {
  it('applies defaults for optional variables', () => {
    expect(validateEnv(validEnv)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      API_KEY: 'k'.repeat(32),
      SWAGGER_ENABLED: false,
      REQUEST_TIMEOUT_MS: 15000,
      MONGO_DB_NAME: 'external_validation',
      MONGO_TIMEOUT_MS: 5000,
      DYNAMODB_TABLE: 'validation_audit',
      DYNAMODB_TIMEOUT_MS: 2000,
      AWS_REGION: 'us-east-1',
      HTTP_TIMEOUT_MS: 5000,
    });
  });

  it('keeps persistence variables optional so HTTP never depends on them', () => {
    const env = validateEnv(validEnv);
    expect(env.MONGO_URI).toBeUndefined();
    expect(env.DYNAMODB_ENDPOINT).toBeUndefined();
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('accepts the persistence variables and treats empty values as unset', () => {
    const env = validateEnv({
      ...validEnv,
      MONGO_URI: 'mongodb://127.0.0.1:27018/?directConnection=true',
      MONGO_TIMEOUT_MS: '3000',
      DYNAMODB_ENDPOINT: 'http://127.0.0.1:8001',
      DYNAMODB_TIMEOUT_MS: '1500',
      AWS_ACCESS_KEY_ID: '',
    });
    expect(env.MONGO_URI).toBe(
      'mongodb://127.0.0.1:27018/?directConnection=true',
    );
    expect(env.MONGO_TIMEOUT_MS).toBe(3000);
    expect(env.DYNAMODB_ENDPOINT).toBe('http://127.0.0.1:8001');
    expect(env.DYNAMODB_TIMEOUT_MS).toBe(1500);
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
  });

  it.each([
    ['MONGO_TIMEOUT_MS', '0'],
    ['DYNAMODB_TIMEOUT_MS', '-1'],
    ['DYNAMODB_ENDPOINT', 'not-a-url'],
    ['DYNAMODB_ENDPOINT', 'ftp://127.0.0.1'],
  ])('rejects invalid %s=%j', (name, value) => {
    expect(() => validateEnv({ ...validEnv, [name]: value })).toThrow(
      new RegExp(name),
    );
  });

  it('coerces numeric strings and strict booleans', () => {
    const env = validateEnv({
      ...validEnv,
      PORT: '3300',
      REQUEST_TIMEOUT_MS: '2500',
      SWAGGER_ENABLED: 'true',
      NODE_ENV: 'production',
    });
    expect(env.PORT).toBe(3300);
    expect(env.REQUEST_TIMEOUT_MS).toBe(2500);
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.NODE_ENV).toBe('production');
  });

  it.each([{}, { API_KEY: '' }, { API_KEY: 'short' }])(
    'rejects a missing or too short API_KEY (%j)',
    (env) => {
      expect(() => validateEnv(env)).toThrow(/API_KEY/);
    },
  );

  it.each(['1', 'yes', 'TRUE', ''])(
    'rejects non-strict boolean %j',
    (value) => {
      expect(() =>
        validateEnv({ ...validEnv, SWAGGER_ENABLED: value }),
      ).toThrow(/SWAGGER_ENABLED/);
    },
  );

  it.each(['0', '-5', 'abc', '1.5'])('rejects invalid timeout %j', (value) => {
    expect(() =>
      validateEnv({ ...validEnv, REQUEST_TIMEOUT_MS: value }),
    ).toThrow(/REQUEST_TIMEOUT_MS/);
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => validateEnv({ ...validEnv, PORT: '70000' })).toThrow(/PORT/);
  });

  it('never includes received values in the error message', () => {
    const secret = 'super-secret-but-short';
    try {
      validateEnv({ API_KEY: secret });
      expect.unreachable('validateEnv should have thrown');
    } catch (error) {
      expect(String(error)).toContain('API_KEY');
      expect(String(error)).not.toContain(secret);
    }
  });
});
