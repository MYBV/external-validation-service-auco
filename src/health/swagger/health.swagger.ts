export const SWCONF_HEALTH = {
  tag: 'health',
  operation: {
    summary: 'Liveness check',
    description:
      'Public endpoint. Reports that the HTTP service is running; it does not check dependencies.',
  },
  okResponse: {
    description: 'The service is running.',
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          required: ['status'],
          properties: { status: { type: 'string', example: 'ok' } },
        },
      },
    },
  },
} as const;
