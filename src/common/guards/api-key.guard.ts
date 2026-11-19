import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type IAppConfig } from '../../config/configuration.js';
import { API_KEY_HEADER } from '../constants/headers.constants.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

const digest = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expectedDigest: Buffer;

  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) config: IAppConfig,
  ) {
    this.expectedDigest = digest(config.apiKey);
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers[API_KEY_HEADER];

    // Digests have equal length, so the comparison is constant-time and does
    // not leak the length of the expected key.
    if (
      typeof provided !== 'string' ||
      !timingSafeEqual(digest(provided), this.expectedDigest)
    ) {
      throw new UnauthorizedException('Missing or invalid API key');
    }
    return true;
  }
}
