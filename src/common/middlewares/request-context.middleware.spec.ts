import type { Request, Response } from 'express';
import type { IRequestContext } from '../interfaces/request-context.interface.js';
import { RequestContextService } from '../services/request-context.service.js';
import { RequestContextMiddleware } from './request-context.middleware.js';

function runMiddleware(headers: Record<string, string | string[]>): {
  context: IRequestContext | undefined;
  setHeader: ReturnType<typeof vi.fn>;
} {
  const service = new RequestContextService();
  const middleware = new RequestContextMiddleware(service);
  const setHeader = vi.fn();
  let context: IRequestContext | undefined;

  middleware.use(
    { headers, originalUrl: '/validations?x=1' } as unknown as Request,
    { setHeader } as unknown as Response,
    () => {
      context = service.get();
    },
  );
  return { context, setHeader };
}

describe('RequestContextMiddleware', () => {
  it('creates the context and returns x-request-id', () => {
    const { context, setHeader } = runMiddleware({});

    expect(context?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context?.requestUrl).toBe('/validations');
    expect(context?.requestUrl).not.toContain('x=1');
    expect(context?.startedAt).toBeInstanceOf(Date);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', context?.requestId);
  });

  it('generates a different requestId per request', () => {
    expect(runMiddleware({}).context?.requestId).not.toBe(
      runMiddleware({}).context?.requestId,
    );
  });

  it.each([
    ['co', 'CO'],
    ['MX', 'MX'],
    ['mX', 'MX'],
  ])('normalizes country code %s to %s', (header, expected) => {
    expect(
      runMiddleware({ 'x-country-code': header }).context?.countryCode,
    ).toBe(expected);
  });

  it.each(['', 'C', 'COL', '1X', 'C ', 'ñÑ'])(
    'leaves countryCode undefined for malformed value %j',
    (header) => {
      expect(
        runMiddleware({ 'x-country-code': header }).context?.countryCode,
      ).toBeUndefined();
    },
  );

  it('leaves countryCode undefined when the header is absent or repeated', () => {
    expect(runMiddleware({}).context?.countryCode).toBeUndefined();
    expect(
      runMiddleware({ 'x-country-code': ['CO', 'MX'] }).context?.countryCode,
    ).toBeUndefined();
  });
});
