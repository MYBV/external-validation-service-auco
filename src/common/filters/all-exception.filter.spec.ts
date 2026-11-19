import {
  type ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { RequestContextService } from '../services/request-context.service.js';
import {
  AllExceptionFilter,
  type IErrorResponse,
} from './all-exception.filter.js';

interface ICapture {
  status?: number;
  body: IErrorResponse;
  headers: Record<string, string>;
}

function handle(
  exception: unknown,
  withContext = true,
  headersSent = false,
): ICapture {
  const service = new RequestContextService();
  const filter = new AllExceptionFilter(service);
  const capture = { headers: {} } as ICapture;
  const response = {
    headersSent,
    setHeader: (name: string, value: string) => {
      capture.headers[name] = value;
    },
    status: (code: number) => {
      capture.status = code;
      return { json: (body: IErrorResponse) => (capture.body = body) };
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        path: '/validations',
        originalUrl: '/validations?token=x',
      }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  const run = () => filter.catch(exception, host);
  if (withContext) {
    service.run(
      {
        requestId: 'ctx-id',
        requestUrl: '/validations',
        startedAt: new Date(),
      },
      run,
    );
  } else {
    run();
  }
  return capture;
}

describe('AllExceptionFilter', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('preserves NestJS HTTP exceptions', () => {
    const { status, body, headers } = handle(new NotFoundException('Missing'));

    expect(status).toBe(404);
    expect(body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: 'Missing',
      path: '/validations',
      requestId: 'ctx-id',
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(body.details).toBeUndefined();
    expect(headers['x-request-id']).toBe('ctx-id');
  });

  it('keeps string messages of custom HTTP exception bodies', () => {
    expect(
      handle(new BadRequestException({ message: 'Bad thing' })).body.message,
    ).toBe('Bad thing');
  });

  it('maps ZodError to 400 with only paths and safe messages', () => {
    const schema = z.object({
      name: z.string().max(3),
      documentNumber: z.string(),
    });
    const result = schema.safeParse({
      name: 'SENSITIVE-PERSON-NAME',
      documentNumber: 123456789,
    });
    expect(result.success).toBe(false);
    const { status, body } = handle(result.error);

    expect(status).toBe(400);
    expect(body.message).toBe('Validation failed');
    expect(body.details?.map((d) => d.path).sort()).toEqual([
      'documentNumber',
      'name',
    ]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('SENSITIVE-PERSON-NAME');
    expect(serialized).not.toContain('123456789');
  });

  it('hides unknown errors behind a generic 500 and does not log their message', () => {
    const logSpy = vi.spyOn(Logger.prototype, 'error');
    const { status, body } = handle(
      new Error('mongodb://user:password@host failed'),
    );

    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('password');
    expect(body).not.toHaveProperty('stack');
    expect(logSpy).toHaveBeenCalledOnce();
    expect(String(logSpy.mock.calls[0]?.[0])).not.toContain('password');
  });

  it('maps Express/body-parser client errors without echoing their message', () => {
    const { status, body } = handle(
      Object.assign(new SyntaxError('Unexpected token s in {"secret"'), {
        status: 400,
        expose: true,
        type: 'entity.parse.failed',
      }),
    );

    expect(status).toBe(400);
    expect(body.message).toBe('Bad Request');
  });

  it.each([
    ['status only (e.g. an HTTP client error)', { status: 404 }],
    ['statusCode only', { statusCode: 400 }],
    ['status and expose without type', { status: 404, expose: true }],
    ['status 4xx but expose false', { status: 400, expose: false, type: 'x' }],
    ['5xx status', { status: 500, expose: true, type: 'x' }],
  ])('treats an unknown error with %s as a generic 500', (_label, props) => {
    const { status, body } = handle(
      Object.assign(new Error('upstream failed: secret-detail'), props),
    );

    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('secret-detail');
  });

  it('does not write a second response when headers were already sent', () => {
    const { status, body, headers } = handle(
      new NotFoundException(),
      true,
      true,
    );

    expect(status).toBeUndefined();
    expect(body).toBeUndefined();
    expect(headers).toEqual({});
  });

  it('generates a requestId and header when there is no ALS context', () => {
    const { body, headers } = handle(new BadRequestException(), false);

    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers['x-request-id']).toBe(body.requestId);
  });
});
