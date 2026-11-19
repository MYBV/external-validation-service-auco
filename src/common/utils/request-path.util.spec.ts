import { getRequestPath } from './request-path.util.js';

describe('getRequestPath', () => {
  it.each([
    ['/validations', '/validations'],
    ['/validations?token=secret', '/validations'],
    ['/validations/abc?a=1&b=2', '/validations/abc'],
    ['/?x=1', '/'],
    ['/validations?', '/validations'],
  ])('maps %s to %s', (input, expected) => {
    expect(getRequestPath(input)).toBe(expected);
  });
});
