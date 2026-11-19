import { Injectable } from '@nestjs/common';
import { requestContextStorage } from '../context/request-context.storage.js';
import type { IRequestContext } from '../interfaces/request-context.interface.js';

@Injectable()
export class RequestContextService {
  /** Runs `callback` (and everything it awaits) inside the given context. */
  run<T>(context: IRequestContext, callback: () => T): T {
    return requestContextStorage.run(context, callback);
  }

  /** Returns the current request context, or undefined outside a request. */
  get(): IRequestContext | undefined {
    return requestContextStorage.getStore();
  }
}
