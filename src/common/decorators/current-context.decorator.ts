import { createParamDecorator } from '@nestjs/common';
import { requestContextStorage } from '../context/request-context.storage.js';
import type { IRequestContext } from '../interfaces/request-context.interface.js';

/**
 * Injects the current request context (or undefined outside a request).
 * Reads the same AsyncLocalStorage instance used by RequestContextService.
 */
export const CurrentContext = createParamDecorator(
  (): IRequestContext | undefined => requestContextStorage.getStore(),
);
