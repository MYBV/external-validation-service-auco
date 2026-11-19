import {
  BadGatewayException,
  GatewayTimeoutException,
  type INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp, TEST_API_KEY } from './support/create-test-app.js';
import {
  makeCountryRepositoryFake,
  makeOutboxRepositoryFake,
  makeRestCountriesFake,
  makeValidationRepositoryFake,
} from './support/validations-fakes.js';

const bodyOf = (response: request.Response): Record<string, unknown> =>
  response.body as Record<string, unknown>;

const NAME = 'Maria Fernanda Lopez';
const DOCUMENT = '1020304050';
const VALID_BODY = { name: NAME, documentNumber: DOCUMENT };

describe('Validations (e2e, in-memory repositories)', () => {
  let app: INestApplication<App>;
  const restCountries = makeRestCountriesFake();
  const validationRepository = makeValidationRepositoryFake();
  const outboxRepository = makeOutboxRepositoryFake();

  beforeAll(async () => {
    app = await createTestApp(
      {},
      {
        customize: (builder, classes) => {
          builder
            .overrideProvider(classes.CountryRepository)
            .useValue(makeCountryRepositoryFake())
            .overrideProvider(classes.ValidationRepository)
            .useValue(validationRepository)
            .overrideProvider(classes.OutboxRepository)
            .useValue(outboxRepository)
            .overrideProvider(classes.RestCountriesService)
            .useValue(restCountries);
        },
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    validationRepository.rows.length = 0;
    outboxRepository.rows.length = 0;
    restCountries.enrich.mockClear();
  });

  const post = (body: unknown = VALID_BODY, country: string | null = 'co') => {
    const req = request(app.getHttpServer())
      .post('/validations')
      .set('x-api-key', TEST_API_KEY);
    return (country === null ? req : req.set('x-country-code', country)).send(
      body as object,
    );
  };

  describe('POST /validations', () => {
    it('creates the record and the pending outbox event', async () => {
      const response = await post().expect(201);

      const data = bodyOf(response)['data'] as { id: string };
      expect(Object.keys(bodyOf(response))).toEqual(['data']);
      expect(Object.keys(data)).toEqual(['id']);
      expect(data.id).toMatch(/^[0-9a-f]{24}$/);
      expect(validationRepository.rows).toHaveLength(1);
      expect(outboxRepository.rows).toHaveLength(1);
      expect(outboxRepository.rows[0]).toMatchObject({
        status: 'PENDING',
        eventType: 'VALIDATION_CREATED',
        attempts: 0,
        countryCode: 'CO',
      });
      expect(restCountries.enrich).toHaveBeenCalledWith('CO');
    });

    it('never sends personal data to the enrichment provider', async () => {
      await post().expect(201);

      expect(JSON.stringify(restCountries.enrich.mock.calls)).not.toContain(
        DOCUMENT,
      );
      expect(JSON.stringify(restCountries.enrich.mock.calls)).not.toContain(
        NAME,
      );
    });

    it('rejects a missing API key with 401', async () => {
      await request(app.getHttpServer())
        .post('/validations')
        .set('x-country-code', 'CO')
        .send(VALID_BODY)
        .expect(401);
      expect(validationRepository.rows).toHaveLength(0);
    });

    it('rejects an invalid API key with 401', async () => {
      await request(app.getHttpServer())
        .post('/validations')
        .set('x-api-key', 'wrong')
        .set('x-country-code', 'CO')
        .send(VALID_BODY)
        .expect(401);
    });

    it('requires x-country-code (400)', async () => {
      const response = await post(VALID_BODY, null).expect(400);
      expect(bodyOf(response)['message']).toBe('Validation failed');
      expect(restCountries.enrich).not.toHaveBeenCalled();
    });

    it.each(['COL', '1', 'C', ''])(
      'rejects the malformed x-country-code %j (400)',
      async (code) => {
        await post(VALID_BODY, code).expect(400);
      },
    );

    it('rejects an unknown country with 400 and the public message', async () => {
      const response = await post(VALID_BODY, 'ZZ').expect(400);
      expect(bodyOf(response)['message']).toBe('Unsupported country code');
      expect(restCountries.enrich).not.toHaveBeenCalled();
    });

    it('rejects a disabled country with the same public message', async () => {
      const response = await post(VALID_BODY, 'MX').expect(400);
      expect(bodyOf(response)['message']).toBe('Unsupported country code');
    });

    it.each([
      ['missing name', { documentNumber: DOCUMENT }],
      ['missing documentNumber', { name: NAME }],
      ['empty name', { name: '   ', documentNumber: DOCUMENT }],
      ['name too long', { name: 'a'.repeat(121), documentNumber: DOCUMENT }],
      ['document too long', { name: NAME, documentNumber: '1'.repeat(65) }],
      ['non-string name', { name: 12, documentNumber: DOCUMENT }],
      ['unknown field', { ...VALID_BODY, nationality: 'CO' }],
      ['control characters', { name: 'Ana\u0000', documentNumber: DOCUMENT }],
    ])('rejects an invalid body: %s (400)', async (_label, body) => {
      const response = await post(body).expect(400);
      expect(bodyOf(response)['message']).toBe('Validation failed');
      expect(validationRepository.rows).toHaveLength(0);
      expect(outboxRepository.rows).toHaveLength(0);
    });

    it('does not echo the received values in validation errors', async () => {
      const response = await post({
        name: 'Secret Person',
        documentNumber: DOCUMENT,
        extra: 'sensitive-extra',
      }).expect(400);

      const text = JSON.stringify(response.body);
      expect(text).not.toContain('Secret Person');
      expect(text).not.toContain(DOCUMENT);
      expect(text).not.toContain('sensitive-extra');
    });

    it.each([
      ['502', new BadGatewayException('Geographic enrichment unavailable')],
      ['504', new GatewayTimeoutException('Geographic enrichment unavailable')],
      [
        '503',
        new ServiceUnavailableException('Geographic enrichment unavailable'),
      ],
    ])(
      'maps an enrichment failure to %s and persists nothing',
      async (status, error) => {
        restCountries.enrich.mockRejectedValueOnce(error);

        const response = await post().expect(Number(status));

        expect(bodyOf(response)['message']).toBe(
          'Geographic enrichment unavailable',
        );
        expect(validationRepository.rows).toHaveLength(0);
        expect(outboxRepository.rows).toHaveLength(0);
      },
    );

    it('rejects an invalid Idempotency-Key (400)', async () => {
      await post().set('Idempotency-Key', 'short').expect(400);
      await post()
        .set('Idempotency-Key', 'has spaces and !! symbols')
        .expect(400);
    });

    it('creates distinct records without an Idempotency-Key', async () => {
      const first = await post().expect(201);
      const second = await post().expect(201);

      expect(bodyOf(first)['data']).not.toEqual(bodyOf(second)['data']);
      expect(validationRepository.rows).toHaveLength(2);
      expect(outboxRepository.rows).toHaveLength(2);
    });

    it('replays an idempotent request with 201 and the same id', async () => {
      const key = 'order-2026-0001';
      const first = await post().set('Idempotency-Key', key).expect(201);
      const replay = await post(
        { name: `  ${NAME}  `, documentNumber: ` ${DOCUMENT}` },
        'CO',
      )
        .set('Idempotency-Key', key)
        .expect(201);

      expect(bodyOf(replay)).toEqual(bodyOf(first));
      expect(validationRepository.rows).toHaveLength(1);
      expect(outboxRepository.rows).toHaveLength(1);
      expect(restCountries.enrich).toHaveBeenCalledTimes(1);
    });

    it('answers 409 when the key is reused with different content', async () => {
      const key = 'order-2026-0002';
      await post().set('Idempotency-Key', key).expect(201);

      const response = await post({
        name: NAME,
        documentNumber: '999',
      })
        .set('Idempotency-Key', key)
        .expect(409);

      expect(bodyOf(response)['message']).toBe(
        'Idempotency key reuse with different content',
      );
      expect(validationRepository.rows).toHaveLength(1);
      expect(outboxRepository.rows).toHaveLength(1);
    });
  });

  describe('GET /validations/:id', () => {
    it('returns the record through the allow-list mapper', async () => {
      const created = await post()
        .set('Idempotency-Key', 'order-2026-0003')
        .expect(201);
      const { id } = bodyOf(created)['data'] as { id: string };

      const response = await request(app.getHttpServer())
        .get(`/validations/${id}`)
        .set('x-api-key', TEST_API_KEY)
        .expect(200);

      const data = bodyOf(response)['data'] as Record<string, unknown>;
      expect(Object.keys(data).sort()).toEqual(
        [
          'countryCode',
          'createdAt',
          'documentNumber',
          'enrichment',
          'id',
          'name',
        ].sort(),
      );
      expect(data).toMatchObject({
        id,
        name: NAME,
        documentNumber: DOCUMENT,
        countryCode: 'CO',
      });
      const text = JSON.stringify(response.body);
      expect(text).not.toContain('idempotencyKey');
      expect(text).not.toContain('requestFingerprint');
      expect(text).not.toContain('eventId');
      expect(text).not.toContain('PENDING');
      expect(text).not.toContain('_id');
    });

    it('does not require x-country-code', async () => {
      const created = await post().expect(201);
      const { id } = bodyOf(created)['data'] as { id: string };

      await request(app.getHttpServer())
        .get(`/validations/${id}`)
        .set('x-api-key', TEST_API_KEY)
        .expect(200);
    });

    it('answers 404 for an unknown id', async () => {
      const response = await request(app.getHttpServer())
        .get('/validations/665f1c2a9b1e8a3d4c5b6a79')
        .set('x-api-key', TEST_API_KEY)
        .expect(404);

      expect(bodyOf(response)['message']).toBe('Validation not found');
    });

    it.each(['abc', '665f1c2a9b1e8a3d4c5b6a7', '665f1c2a9b1e8a3d4c5b6a7z'])(
      'answers 400 for the malformed id %j',
      async (id) => {
        await request(app.getHttpServer())
          .get(`/validations/${id}`)
          .set('x-api-key', TEST_API_KEY)
          .expect(400);
      },
    );

    it('requires the API key (401)', async () => {
      await request(app.getHttpServer())
        .get('/validations/665f1c2a9b1e8a3d4c5b6a79')
        .expect(401);
    });
  });

  it('keeps the request id and the error contract on failures', async () => {
    const response = await post(VALID_BODY, 'ZZ').expect(400);

    expect(Object.keys(bodyOf(response)).sort()).toEqual(
      [
        'error',
        'message',
        'path',
        'requestId',
        'statusCode',
        'timestamp',
      ].sort(),
    );
    expect(response.headers['x-request-id']).toBe(
      bodyOf(response)['requestId'],
    );
    expect(JSON.stringify(response.body)).not.toContain(TEST_API_KEY);
  });
});
