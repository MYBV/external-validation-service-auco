/** Mutable list: Swagger's SchemaObject rejects readonly arrays. */
const list = (...values: string[]): string[] => values;

/** Body of every error response (see AllExceptionFilter). */
const ERROR_BODY_SCHEMA = {
  type: 'object',
  required: list(
    'statusCode',
    'error',
    'message',
    'path',
    'timestamp',
    'requestId',
  ),
  properties: {
    statusCode: { type: 'number', example: 400 },
    error: { type: 'string', example: 'Bad Request' },
    message: { type: 'string', example: 'Validation failed' },
    path: { type: 'string', example: '/validations' },
    timestamp: { type: 'string', format: 'date-time' },
    requestId: { type: 'string', format: 'uuid' },
    details: {
      type: 'array',
      description: 'Present on Zod validation failures; never echoes values.',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
};

const errorResponse = (description: string) => ({
  description,
  schema: ERROR_BODY_SCHEMA,
});

export const SWCONF_VALIDATIONS = {
  tag: 'validations',
  headers: {
    countryCode: {
      name: 'x-country-code',
      description:
        'ISO 3166-1 alpha-2 code of an enabled country (required for POST only).',
      required: true,
      schema: {
        type: 'string',
        pattern: '^[A-Za-z]{2}$',
        minLength: 2,
        maxLength: 2,
        example: 'CO',
      },
    },
    idempotencyKey: {
      name: 'Idempotency-Key',
      description:
        'Optional. 8-128 characters of letters, digits, "_", ".", ":" or "-". Retrying with the same key and content returns the same id; the same key with different content returns 409.',
      required: false,
      schema: {
        type: 'string',
        pattern: '^[A-Za-z0-9_.:-]{8,128}$',
        minLength: 8,
        maxLength: 128,
        example: 'order-2026-0001',
      },
    },
  },
  create: {
    operation: {
      summary: 'Create a validation record',
      description:
        'Stores the record with geographic enrichment of the selected country. Enrichment is not identity verification.',
    },
    body: {
      schema: {
        type: 'object',
        required: list('name', 'documentNumber'),
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          documentNumber: { type: 'string', minLength: 1, maxLength: 64 },
        },
      },
    },
    createdResponse: {
      description:
        'Created (also returned when an idempotent request is replayed).',
      schema: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', example: '665f1c2a9b1e8a3d4c5b6a79' },
            },
          },
        },
      },
    },
    badRequest: errorResponse(
      'Invalid body or headers, or unsupported country code.',
    ),
    unauthorized: errorResponse('Missing or invalid API key.'),
    conflict: errorResponse(
      'Idempotency-Key already used with different content.',
    ),
    badGateway: errorResponse('Geographic enrichment unavailable.'),
    serviceUnavailable: errorResponse(
      'Provider rate limit, or the outcome could not be confirmed; retry with the same Idempotency-Key.',
    ),
    gatewayTimeout: errorResponse('Geographic enrichment timed out.'),
  },
  get: {
    params: {
      id: {
        name: 'id',
        description: 'Validation id: a 24-character hexadecimal ObjectId.',
        required: true,
        schema: {
          type: 'string',
          pattern: '^[0-9a-fA-F]{24}$',
          minLength: 24,
          maxLength: 24,
          example: '665f1c2a9b1e8a3d4c5b6a79',
        },
      },
    },
    operation: {
      summary: 'Get a validation record',
      description: 'Does not require x-country-code.',
    },
    okResponse: {
      description: 'The validation record.',
      schema: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: [
              'id',
              'name',
              'documentNumber',
              'countryCode',
              'enrichment',
              'createdAt',
            ],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              documentNumber: { type: 'string' },
              countryCode: { type: 'string' },
              enrichment: { type: 'object' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    badRequest: errorResponse('Malformed id.'),
    unauthorized: errorResponse('Missing or invalid API key.'),
    notFound: errorResponse('Validation not found.'),
  },
} as const;
