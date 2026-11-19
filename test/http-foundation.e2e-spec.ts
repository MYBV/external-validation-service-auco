import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp, TEST_API_KEY } from './support/create-test-app.js';

/** Response bodies are untrusted JSON: expose them as unknown. */
const bodyOf = (response: request.Response): unknown => response.body;
const requestIdOf = (response: request.Response): unknown =>
  response.headers['x-request-id'];

describe('HTTP foundation (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('is public and wrapped in { data }', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(bodyOf(response)).toEqual({ data: { status: 'ok' } });
      expect(requestIdOf(response)).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('does not advertise the framework in X-Powered-By', async () => {
      const ok = await request(app.getHttpServer()).get('/health').expect(200);
      const notFound = await request(app.getHttpServer())
        .get('/nope')
        .expect(404);

      expect(ok.headers['x-powered-by']).toBeUndefined();
      expect(notFound.headers['x-powered-by']).toBeUndefined();
    });

    it('exposes no prefix and no hello-world route', async () => {
      await request(app.getHttpServer()).get('/api/v1/health').expect(404);
      await request(app.getHttpServer()).get('/').expect(404);
    });
  });

  describe('API key', () => {
    it.each([
      ['missing', undefined],
      ['wrong', 'wrong-key'],
    ])('rejects a %s key with 401', async (_label, key) => {
      const req = request(app.getHttpServer()).get('/__test/protected');
      const response = await (key ? req.set('x-api-key', key) : req).expect(
        401,
      );

      expect(bodyOf(response)).toMatchObject({
        statusCode: 401,
        error: 'Unauthorized',
        path: '/__test/protected',
      });
      expect(JSON.stringify(bodyOf(response))).not.toContain(TEST_API_KEY);
    });

    it('accepts the configured key', async () => {
      await request(app.getHttpServer())
        .get('/__test/protected')
        .set('x-api-key', TEST_API_KEY)
        .expect(200);
    });
  });

  describe('request context', () => {
    it('shares requestId between header, context decorator and errors', async () => {
      const ok = await request(app.getHttpServer())
        .get('/__test/protected')
        .set('x-api-key', TEST_API_KEY)
        .set('x-country-code', 'mx')
        .expect(200);
      expect(bodyOf(ok)).toEqual({
        data: { requestId: requestIdOf(ok), countryCode: 'MX' },
      });

      const unauthorized = await request(app.getHttpServer())
        .get('/__test/protected')
        .expect(401);
      expect(bodyOf(unauthorized)).toMatchObject({
        requestId: requestIdOf(unauthorized),
      });
    });

    it('keeps each concurrent request in its own context across awaits', async () => {
      const total = 30;
      const responses = await Promise.all(
        Array.from({ length: total }, (_, index) =>
          request(app.getHttpServer())
            .get(`/__test/echo?delay=${(index % 6) * 10}`)
            .set('x-api-key', TEST_API_KEY),
        ),
      );

      const seen = new Set<unknown>();
      for (const response of responses) {
        expect(response.status).toBe(200);
        const requestId = requestIdOf(response);
        expect(bodyOf(response)).toEqual({
          data: {
            beforeRequestId: requestId,
            afterRequestId: requestId,
            requestUrl: '/__test/echo',
          },
        });
        seen.add(requestId);
      }
      expect(seen.size).toBe(total);
    });

    it('does not set countryCode for a malformed header', async () => {
      const response = await request(app.getHttpServer())
        .get('/__test/protected')
        .set('x-api-key', TEST_API_KEY)
        .set('x-country-code', 'COL')
        .expect(200);
      expect(bodyOf(response)).toEqual({
        data: { requestId: requestIdOf(response) },
      });
    });
  });

  describe('response envelope', () => {
    it('wraps null without treating it as an error', async () => {
      const response = await request(app.getHttpServer())
        .get('/__test/null')
        .set('x-api-key', TEST_API_KEY)
        .expect(200);
      expect(bodyOf(response)).toEqual({ data: null });
    });
  });

  describe('error contract', () => {
    const authed = (req: request.Test): request.Test =>
      req.set('x-api-key', TEST_API_KEY);

    it('preserves HTTP exceptions', async () => {
      const response = await authed(
        request(app.getHttpServer()).get('/__test/not-found'),
      ).expect(404);

      expect(bodyOf(response)).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        message: 'Resource not found',
        path: '/__test/not-found',
        requestId: requestIdOf(response),
      });
      expect(JSON.stringify(bodyOf(response))).toMatch(
        /"timestamp":"\d{4}-\d{2}-\d{2}T[^"]*Z"/,
      );
    });

    it('excludes the query string from the error path', async () => {
      const response = await authed(
        request(app.getHttpServer()).get(
          '/__test/not-found?token=query-secret&x=1',
        ),
      ).expect(404);

      expect(bodyOf(response)).toMatchObject({ path: '/__test/not-found' });
      expect(JSON.stringify(bodyOf(response))).not.toContain('query-secret');
    });

    it('returns the uniform format for unknown routes', async () => {
      const response = await authed(
        request(app.getHttpServer()).get('/does-not-exist'),
      ).expect(404);

      expect(bodyOf(response)).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        path: '/does-not-exist',
        requestId: requestIdOf(response),
      });
    });

    it('maps ZodError to 400 without leaking submitted values', async () => {
      const response = await authed(
        request(app.getHttpServer()).post('/__test/zod'),
      ).expect(400);

      expect(bodyOf(response)).toMatchObject({
        statusCode: 400,
        message: 'Validation failed',
        details: [{ path: 'name' }, { path: 'documentNumber' }],
      });
      const raw = JSON.stringify(bodyOf(response));
      expect(raw).not.toContain('SENSITIVE-PERSON-NAME');
      expect(raw).not.toContain('123456789');
    });

    it('hides internal errors behind a generic 500', async () => {
      const response = await authed(
        request(app.getHttpServer()).get('/__test/boom'),
      ).expect(500);

      expect(bodyOf(response)).toMatchObject({
        statusCode: 500,
        message: 'Internal server error',
      });
      const raw = JSON.stringify(bodyOf(response));
      expect(raw).not.toContain('db-password');
      expect(raw).not.toContain('stack');
    });

    it('answers malformed JSON with 400 and a generated requestId', async () => {
      const response = await authed(
        request(app.getHttpServer())
          .post('/__test/zod')
          .set('content-type', 'application/json')
          .send('{"name": "SENSITIVE-BODY"'),
      ).expect(400);

      expect(bodyOf(response)).toMatchObject({
        statusCode: 400,
        requestId: requestIdOf(response),
      });
      expect(requestIdOf(response)).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(bodyOf(response))).not.toContain('SENSITIVE-BODY');
    });

    it('answers 504 when the request exceeds REQUEST_TIMEOUT_MS', async () => {
      const response = await authed(
        request(app.getHttpServer()).get('/__test/slow'),
      ).expect(504);

      expect(bodyOf(response)).toMatchObject({
        statusCode: 504,
        error: 'Gateway Timeout',
        message: 'Request timeout',
      });
    });
  });
});
