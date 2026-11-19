import { assertLocalDynamoEndpoint } from './infrastructure-guards.js';

describe('assertLocalDynamoEndpoint', () => {
  it.each([
    'http://127.0.0.1:8001',
    'http://localhost:8000',
    'http://[::1]:8000',
  ])('accepts the local endpoint %s', (endpoint) => {
    expect(assertLocalDynamoEndpoint(endpoint)).toBe(endpoint);
  });

  it.each([undefined, '', '   '])(
    'rejects a missing endpoint (%j)',
    (value) => {
      expect(() => assertLocalDynamoEndpoint(value)).toThrow(/must be set/);
    },
  );

  it.each([
    'https://dynamodb.us-east-1.amazonaws.com',
    'http://10.0.0.5:8000',
    'http://localhost.evil.com:8000',
  ])('rejects the remote endpoint %s', (endpoint) => {
    expect(() => assertLocalDynamoEndpoint(endpoint)).toThrow(
      /refusing to use a remote endpoint/,
    );
  });

  it('rejects an invalid URL', () => {
    expect(() => assertLocalDynamoEndpoint('not a url')).toThrow(/valid URL/);
  });
});
