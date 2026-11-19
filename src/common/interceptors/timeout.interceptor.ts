import {
  type CallHandler,
  type ExecutionContext,
  GatewayTimeoutException,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import {
  catchError,
  type Observable,
  throwError,
  timeout,
  TimeoutError,
} from 'rxjs';
import { APP_CONFIG, type IAppConfig } from '../../config/configuration.js';

/**
 * Fails a request with 504 when the handler does not emit within
 * REQUEST_TIMEOUT_MS.
 *
 * IMPORTANT: this is an RxJS timeout. It unsubscribes from the handler's
 * observable and answers the client, but it does NOT cancel work already in
 * flight: a MongoDB or DynamoDB write started by the handler may still
 * complete after the 504 was sent. Dependency-level timeouts (and, later,
 * the audit best-effort budget) must be configured separately.
 */
@Injectable()
export class TimeOutInterceptor implements NestInterceptor {
  constructor(@Inject(APP_CONFIG) private readonly config: IAppConfig) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.config.requestTimeoutMs),
      catchError((error: unknown) =>
        error instanceof TimeoutError
          ? throwError(() => new GatewayTimeoutException('Request timeout'))
          : throwError(() => error),
      ),
    );
  }
}
