import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

export interface IResponseEnvelope<T> {
  data: T;
}

/**
 * Wraps successful responses as `{ data }`. It never inspects or transforms
 * the payload (null, false, 0 and [] are valid data) and never handles errors;
 * field mapping belongs to module mappers.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  IResponseEnvelope<T>
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<IResponseEnvelope<T>> {
    return next.handle().pipe(map((data) => ({ data })));
  }
}
