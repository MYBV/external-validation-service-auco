import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { IRequestContext } from '../interfaces/request-context.interface.js';
import {
  COUNTRY_CODE_HEADER,
  REQUEST_ID_HEADER,
} from '../constants/headers.constants.js';
import { RequestContextService } from '../services/request-context.service.js';
import { getRequestPath } from '../utils/request-path.util.js';

const TWO_LETTER_CODE = /^[A-Za-z]{2}$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const rawCountryCode = req.headers[COUNTRY_CODE_HEADER];
    const countryCode =
      typeof rawCountryCode === 'string' && TWO_LETTER_CODE.test(rawCountryCode)
        ? rawCountryCode.toUpperCase()
        : undefined;

    const context: IRequestContext = {
      requestId: randomUUID(),
      requestUrl: getRequestPath(req.originalUrl),
      startedAt: new Date(),
      countryCode,
    };

    res.setHeader(REQUEST_ID_HEADER, context.requestId);
    this.requestContext.run(context, () => next());
  }
}
