import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './support/create-test-app.js';

interface IParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: { pattern?: string };
}

interface IOperation {
  security?: Array<Record<string, unknown>>;
  parameters?: IParameter[];
  requestBody?: {
    required?: boolean;
    content: {
      'application/json': {
        schema: { additionalProperties?: boolean; required?: string[] };
      };
    };
  };
  responses: Record<
    string,
    { content?: Record<string, { schema: { required?: string[] } }> }
  >;
}

interface IOpenApiDocument {
  paths: Record<string, Record<string, IOperation>>;
}

describe('OpenAPI document of the validations API (e2e)', () => {
  let app: INestApplication<App>;
  let post: IOperation;
  let get: IOperation;
  let health: IOperation;

  beforeAll(async () => {
    app = await createTestApp({ SWAGGER_ENABLED: 'true' });
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const document = response.body as IOpenApiDocument;
    post = document.paths['/validations']?.['post'] as IOperation;
    get = document.paths['/validations/{id}']?.['get'] as IOperation;
    health = document.paths['/health']?.['get'] as IOperation;
  });

  afterAll(async () => {
    await app.close();
  });

  const header = (operation: IOperation, name: string) =>
    operation.parameters?.find(
      (parameter) => parameter.in === 'header' && parameter.name === name,
    );

  it('documents both operations', () => {
    expect(post).toBeDefined();
    expect(get).toBeDefined();
  });

  it('protects both validation operations with x-api-key and keeps health public', () => {
    expect(post.security).toEqual([{ 'api-key': [] }]);
    expect(get.security).toEqual([{ 'api-key': [] }]);
    expect(health.security).toBeUndefined();
  });

  it('requires x-country-code only on POST', () => {
    expect(header(post, 'x-country-code')).toMatchObject({
      required: true,
      schema: { pattern: '^[A-Za-z]{2}$' },
    });
    expect(header(get, 'x-country-code')).toBeUndefined();
  });

  it('documents Idempotency-Key as an optional POST header only', () => {
    const idempotency = header(post, 'Idempotency-Key');
    expect(idempotency?.required).toBe(false);
    expect(idempotency?.schema?.pattern).toBe('^[A-Za-z0-9_.:-]{8,128}$');
    expect(header(get, 'Idempotency-Key')).toBeUndefined();
  });

  it('documents the strict POST body', () => {
    const schema = post.requestBody?.content['application/json'].schema;
    expect(post.requestBody?.required).toBe(true);
    expect(schema?.required).toEqual(['name', 'documentNumber']);
    expect(schema?.additionalProperties).toBe(false);
  });

  it('documents the id path parameter of GET', () => {
    const id = get.parameters?.find((parameter) => parameter.in === 'path');
    expect(id).toMatchObject({
      name: 'id',
      required: true,
      schema: { pattern: '^[0-9a-fA-F]{24}$' },
    });
  });

  it('documents the expected status codes', () => {
    expect(Object.keys(post.responses).sort()).toEqual(
      ['201', '400', '401', '409', '502', '503', '504'].sort(),
    );
    expect(Object.keys(get.responses).sort()).toEqual(
      ['200', '400', '401', '404'].sort(),
    );
  });

  it('documents the success envelope and the common error body', () => {
    const created =
      post.responses['201']?.content?.['application/json']?.schema;
    expect(created?.required).toEqual(['data']);
    for (const operation of [post, get]) {
      for (const [status, response] of Object.entries(operation.responses)) {
        if (Number(status) >= 400) {
          expect(
            response.content?.['application/json']?.schema.required,
          ).toEqual([
            'statusCode',
            'error',
            'message',
            'path',
            'timestamp',
            'requestId',
          ]);
        }
      }
    }
  });
});
