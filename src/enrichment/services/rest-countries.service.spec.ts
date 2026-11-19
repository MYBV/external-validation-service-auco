import type { HttpService } from '@nestjs/axios';
import {
  BadGatewayException,
  GatewayTimeoutException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AxiosError, type AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import type { MockInstance } from 'vitest';
import { ZodError } from 'zod';
import { makeAppConfig } from '../../../test/support/app-config.js';
import type { RequestContextService } from '../../common/services/request-context.service.js';
import {
  ENRICHMENT_UNAVAILABLE_MESSAGE,
  RestCountriesService,
} from './rest-countries.service.js';

const PROVIDER_KEY = 'provider-secret-key-for-tests';
const PROVIDER_BODY_MARKER = 'PROVIDER_ERROR_BODY_MARKER';

function v5Body(code: string, name: string): unknown {
  return {
    data: {
      objects: [
        {
          codes: { alpha_2: code },
          names: { common: name, official: `Republic of ${name}` },
          region: 'Americas',
          subregion: 'Latin America',
          capitals: [{ name: 'Capital city' }],
          languages: [{ name: 'Spanish' }],
          currencies: [{ code: 'XXX', name: 'Peso', symbol: '$' }],
        },
      ],
      meta: { total: 1 },
    },
  };
}

function httpResponse(data: unknown): AxiosResponse {
  return { data, status: 200 } as AxiosResponse;
}

function upstreamError(status: number): AxiosError {
  const response = {
    status,
    data: { errors: [{ code: 'x', message: PROVIDER_BODY_MARKER }] },
  } as AxiosResponse;
  return new AxiosError(
    PROVIDER_BODY_MARKER,
    AxiosError.ERR_BAD_RESPONSE,
    undefined,
    undefined,
    response,
  );
}

describe('RestCountriesService', () => {
  const get = vi.fn();
  const requestContext = { get: () => undefined } as RequestContextService;
  const config = makeAppConfig({
    REST_COUNTRIES_API_KEY: PROVIDER_KEY,
    REST_COUNTRIES_BASE_URL: 'https://provider.test/countries/v5/',
  });
  let service: RestCountriesService;
  let warn: MockInstance<Logger['warn']>;
  let error: MockInstance<Logger['error']>;

  beforeEach(() => {
    vi.resetAllMocks();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    service = new RestCountriesService(
      { get } as unknown as HttpService,
      requestContext,
      config,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['CO', 'Colombia'],
    ['MX', 'Mexico'],
  ])('maps a v5 response for %s', async (code, name) => {
    get.mockReturnValue(of(httpResponse(v5Body(code, name))));

    const result = await service.enrich(code);

    expect(result).toMatchObject({
      source: 'rest-countries',
      code,
      commonName: name,
      officialName: `Republic of ${name}`,
      region: 'Americas',
      subregion: 'Latin America',
      capitals: ['Capital city'],
      languages: ['Spanish'],
      currencies: [{ code: 'XXX', name: 'Peso', symbol: '$' }],
    });
    expect(result.enrichedAt).toBeInstanceOf(Date);
  });

  it('omits absent optional strings instead of storing undefined', async () => {
    get.mockReturnValue(
      of(
        httpResponse({
          data: {
            objects: [
              { codes: { alpha_2: 'CO' }, names: { common: 'Colombia' } },
            ],
          },
        }),
      ),
    );

    const result = await service.enrich('CO');

    expect(Object.keys(result).sort()).toEqual(
      [
        'capitals',
        'code',
        'commonName',
        'currencies',
        'enrichedAt',
        'languages',
        'source',
      ].sort(),
    );
  });

  it('sends only the code, the bearer header and response_fields, once', async () => {
    get.mockReturnValue(of(httpResponse(v5Body('CO', 'Colombia'))));

    await service.enrich('co');

    expect(get).toHaveBeenCalledOnce();
    const [url, options] = get.mock.calls[0] as [
      string,
      {
        params: Record<string, string>;
        headers: Record<string, string>;
      },
    ];
    expect(url).toBe('https://provider.test/countries/v5/codes.alpha_2/CO');
    expect(url).not.toContain(PROVIDER_KEY);
    expect(options.headers['Authorization']).toBe(`Bearer ${PROVIDER_KEY}`);
    expect(options.params).toEqual({
      response_fields: expect.stringContaining('capitals') as string,
    });
    expect(Object.keys(options.params)).toEqual(['response_fields']);
    expect(JSON.stringify(options.params)).not.toContain(PROVIDER_KEY);
    expect(options).not.toHaveProperty('data');
  });

  it('rejects a malformed code before calling the provider', async () => {
    await expect(service.enrich('Juan Perez 123')).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(get).not.toHaveBeenCalled();
  });

  describe('provider failures', () => {
    const cases: [string, () => unknown, new (...args: never[]) => Error][] = [
      [
        'timeout (ECONNABORTED)',
        () => new AxiosError('timeout', AxiosError.ECONNABORTED, undefined, {}),
        GatewayTimeoutException,
      ],
      [
        'timeout (ETIMEDOUT)',
        () => new AxiosError('timeout', AxiosError.ETIMEDOUT, undefined, {}),
        GatewayTimeoutException,
      ],
      ['401', () => upstreamError(401), BadGatewayException],
      ['403', () => upstreamError(403), BadGatewayException],
      ['404', () => upstreamError(404), BadGatewayException],
      ['429', () => upstreamError(429), ServiceUnavailableException],
      ['500', () => upstreamError(500), BadGatewayException],
      ['503', () => upstreamError(503), BadGatewayException],
      [
        'network error',
        () => new AxiosError('boom', AxiosError.ERR_NETWORK),
        BadGatewayException,
      ],
      ['unexpected error', () => new Error('weird'), BadGatewayException],
    ];

    it.each(cases)(
      'translates %s without exposing provider details',
      async (_label, makeError, expected) => {
        get.mockReturnValue(throwError(makeError));

        const failure: unknown = await service
          .enrich('CO')
          .catch((caught: unknown) => caught);

        expect(failure).toBeInstanceOf(expected);
        expect(get).toHaveBeenCalledOnce();
        const serialized = JSON.stringify((failure as Error).message);
        expect(serialized).toContain(ENRICHMENT_UNAVAILABLE_MESSAGE);
        expect(serialized).not.toContain(PROVIDER_BODY_MARKER);
        expect(serialized).not.toContain(PROVIDER_KEY);
        const logged = JSON.stringify([
          ...warn.mock.calls,
          ...error.mock.calls,
        ]);
        expect(logged).not.toContain(PROVIDER_KEY);
        expect(logged).not.toContain(PROVIDER_BODY_MARKER);
      },
    );
  });

  describe('invalid provider responses', () => {
    it.each([
      ['empty objects', { data: { objects: [] } }],
      ['code mismatch', v5Body('CA', 'Canada')],
      ['invalid schema', { data: { objects: [{ names: {} }] } }],
      ['non-JSON body', '<html>gateway</html>'],
      ['null body', null],
    ])('answers 502 for %s', async (_label, body) => {
      get.mockReturnValue(of(httpResponse(body)));

      await expect(service.enrich('CO')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });

  it('fails at construction when the provider key is missing', () => {
    const attempt = () =>
      new RestCountriesService(
        { get } as unknown as HttpService,
        requestContext,
        makeAppConfig(),
      );

    expect(attempt).toThrow(/REST_COUNTRIES_API_KEY/);
  });
});
