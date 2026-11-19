import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

interface IHeadersCarrier {
  readonly headers: Record<string, unknown>;
}

/**
 * Injects the raw request headers so a pipe (for example ZodValidationPipe)
 * can validate the ones an endpoint needs. Header names are lowercase.
 */
export const RequestHeaders = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Record<string, unknown> =>
    context.switchToHttp().getRequest<IHeadersCarrier>().headers,
);
