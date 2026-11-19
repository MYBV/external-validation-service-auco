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
    });
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
