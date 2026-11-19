import { AsyncLocalStorage } from 'node:async_hooks';
import type { IRequestContext } from '../interfaces/request-context.interface.js';

/**
 * The single AsyncLocalStorage instance of the application. Both
 * RequestContextService and @CurrentContext() use it; never create another.
 */
export const requestContextStorage = new AsyncLocalStorage<IRequestContext>();
