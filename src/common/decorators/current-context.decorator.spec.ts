import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { requestContextStorage } from '../context/request-context.storage.js';
import type { IRequestContext } from '../interfaces/request-context.interface.js';
import { RequestContextService } from '../services/request-context.service.js';
import { CurrentContext } from './current-context.decorator.js';

class Probe {
  handler(@CurrentContext() _context: IRequestContext | undefined): void {}
}

function resolveDecorator(): IRequestContext | undefined {
  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    Probe,
    'handler',
  ) as Record<string, { factory: (data: unknown, ctx: unknown) => unknown }>;
  const [entry] = Object.values(metadata);
  return entry?.factory(undefined, undefined) as IRequestContext | undefined;
}

describe('@CurrentContext()', () => {
  it('resolves the context stored by RequestContextService', () => {
    const context: IRequestContext = {
      requestId: 'id',
      requestUrl: '/x',
      startedAt: new Date(0),
      countryCode: 'CO',
    };
    new RequestContextService().run(context, () => {
      expect(resolveDecorator()).toBe(context);
      expect(requestContextStorage.getStore()).toBe(context);
    });
  });

  it('resolves undefined outside a request', () => {
    expect(resolveDecorator()).toBeUndefined();
  });
});
