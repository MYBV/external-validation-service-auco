import { RequestContextService } from './request-context.service.js';
import type { IRequestContext } from '../interfaces/request-context.interface.js';

const buildContext = (requestId: string): IRequestContext => ({
  requestId,
  requestUrl: '/x',
  startedAt: new Date(0),
});

describe('RequestContextService', () => {
  const service = new RequestContextService();

  it('returns undefined outside a request', () => {
    expect(service.get()).toBeUndefined();
  });

  it('exposes the context inside run(), including after awaits', async () => {
    const context = buildContext('a');
    await service.run(context, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(service.get()).toBe(context);
    });
    expect(service.get()).toBeUndefined();
  });

  it('isolates concurrent contexts', async () => {
    const seen = await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        service.run(buildContext(id), async () => {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 10),
          );
          return service.get()?.requestId;
        }),
      ),
    );
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});
