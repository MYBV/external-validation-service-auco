import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { REQUEST_ID_HEADER } from '../constants/headers.constants.js';
import { RequestContextService } from '../services/request-context.service.js';
import { getRequestPath } from '../utils/request-path.util.js';

export interface IErrorDetail {
  readonly path: string;
  readonly message: string;
}

export interface IErrorResponse {
  readonly statusCode: number;
  readonly error: string;
  readonly message: string;
  readonly path: string;
  readonly timestamp: string;
  readonly requestId: string;
  readonly details?: readonly IErrorDetail[];
}

interface INormalizedError {
  readonly statusCode: number;
  readonly message: string;
  readonly details?: readonly IErrorDetail[];
}

const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/**
 * Converts every exception into the public error contract. It preserves the
 * status of HTTP exceptions, maps ZodError to 400 exposing only field paths
 * and safe messages, and hides everything else behind a generic 500. Stack
 * traces, received values and internal messages are never sent to clients.
 */
@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionFilter.name);

  constructor(private readonly requestContext: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    // Requests rejected before the middleware (e.g. malformed JSON) have no
    // ALS context: generate an id and expose it in the header as well.
    const requestId = this.requestContext.get()?.requestId ?? randomUUID();
    const normalized = this.normalize(exception);
    const path = getRequestPath(request.originalUrl);

    if (normalized.statusCode >= 500) {
      this.logger.error(
        `[${requestId}] ${request.method} ${path} -> ${normalized.statusCode} (${this.describe(exception)})`,
      );
    }

    // The response already started: a second response cannot be emitted.
    if (response.headersSent) {
      return;
    }

    const body: IErrorResponse = {
      statusCode: normalized.statusCode,
      error: STATUS_CODES[normalized.statusCode] ?? 'Error',
      message: normalized.message,
      path,
      timestamp: new Date().toISOString(),
      requestId,
      ...(normalized.details && { details: normalized.details }),
    };

    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.status(normalized.statusCode).json(body);
  }

  private normalize(exception: unknown): INormalizedError {
    if (exception instanceof ZodError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
        details: exception.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      };
    }

    if (exception instanceof HttpException) {
      return {
        statusCode: exception.getStatus(),
        message: this.httpExceptionMessage(exception),
      };
    }

    // Client errors raised by Express middleware (e.g. body-parser) are not
    // Nest exceptions. Their messages may echo request content, so only the
    // standard status text is exposed. Any other unknown error (including
    // errors from external clients that happen to carry a `status`) is
    // treated as an internal error.
    const clientStatus = this.expressClientErrorStatus(exception);
    if (clientStatus !== undefined) {
      return {
        statusCode: clientStatus,
        message: STATUS_CODES[clientStatus] ?? 'Bad Request',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: INTERNAL_ERROR_MESSAGE,
    };
  }

  private httpExceptionMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') {
      return response;
    }
    if (typeof response === 'object' && 'message' in response) {
      const { message } = response;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message)) {
        return message.filter((m) => typeof m === 'string').join('; ');
      }
    }
    return exception.message;
  }

  /**
   * Recognizes the client errors produced by Express and body-parser (built
   * with http-errors): a 4xx `status`, `expose: true` and a string `type`
   * such as `entity.parse.failed`. A bare `status` is not enough.
   */
  private expressClientErrorStatus(exception: unknown): number | undefined {
    if (
      exception instanceof Error &&
      'status' in exception &&
      'expose' in exception &&
      'type' in exception
    ) {
      const { status, expose, type } = exception;
      if (
        typeof status === 'number' &&
        status >= 400 &&
        status < 500 &&
        expose === true &&
        typeof type === 'string'
      ) {
        return status;
      }
    }
    return undefined;
  }

  /** Log-safe description: the error class only, never its message. */
  private describe(exception: unknown): string {
    return exception instanceof Error ? exception.name : typeof exception;
  }
}
