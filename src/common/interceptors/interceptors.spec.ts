import {
  type CallHandler,
  type ExecutionContext,
  GatewayTimeoutException,
} from '@nestjs/common';
import { delay, firstValueFrom, type Observable, of, throwError } from 'rxjs';
import type { IAppConfig } from '../../config/configuration.js';
import { ResponseInterceptor } from './response.interceptor.js';
import { TimeOutInterceptor } from './timeout.interceptor.js';

const context = {} as ExecutionContext;
const handlerOf = <T>(stream: Observable<T>): CallHandler<T> => ({
  handle: () => stream,
});

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor<unknown>();

  it.each([[{ a: 1 }], [null], [false], [0], [[]], ['']])(
    'wraps %j as { data } without transforming it',
    async (payload) => {
      const result = await firstValueFrom(
        interceptor.intercept(context, handlerOf(of(payload))),
      );
      expect(result).toEqual({ data: payload });
    },
  );

  it('does not handle errors', async () => {
    const error = new Error('boom');
    await expect(
      firstValueFrom(
        interceptor.intercept(context, {
          handle: () => throwError(() => error),
        }),
      ),
    ).rejects.toBe(error);
  });
});

describe('TimeOutInterceptor', () => {
  const interceptor = new TimeOutInterceptor({
    requestTimeoutMs: 20,
  } as IAppConfig);

  it('lets fast handlers through', async () => {
    await expect(
      firstValueFrom(interceptor.intercept(context, handlerOf(of('ok')))),
    ).resolves.toBe('ok');
  });

  it('turns a slow handler into GatewayTimeoutException', async () => {
    await expect(
      firstValueFrom(
        interceptor.intercept(context, handlerOf(of('late').pipe(delay(200)))),
      ),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('propagates other errors unchanged', async () => {
    const error = new Error('boom');
    await expect(
      firstValueFrom(
        interceptor.intercept(context, {
          handle: () => throwError(() => error),
        }),
      ),
    ).rejects.toBe(error);
  });
});
