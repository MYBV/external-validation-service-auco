import type { MongoService } from '../mongo/mongo.service.js';
import { initializeMongo } from './initialize-mongo.js';

function mongoReturning(hello: Record<string, unknown>): MongoService {
  return {
    db: { admin: () => ({ command: vi.fn().mockResolvedValue(hello) }) },
  } as unknown as MongoService;
}

describe('initializeMongo', () => {
  it('ensures the indexes of every repository on a replica set primary', async () => {
    const first = { ensureIndexes: vi.fn().mockResolvedValue(undefined) };
    const second = { ensureIndexes: vi.fn().mockResolvedValue(undefined) };

    await initializeMongo(
      mongoReturning({ setName: 'rs0', isWritablePrimary: true }),
      [first, second],
    );

    expect(first.ensureIndexes).toHaveBeenCalledOnce();
    expect(second.ensureIndexes).toHaveBeenCalledOnce();
  });

  it.each([
    { isWritablePrimary: true },
    { setName: 'rs0', isWritablePrimary: false },
  ])(
    'fails when the node is not a writable replica set primary (%j)',
    async (hello) => {
      const repository = { ensureIndexes: vi.fn() };

      await expect(
        initializeMongo(mongoReturning(hello), [repository]),
      ).rejects.toThrow(/writable primary of a replica set/);
      expect(repository.ensureIndexes).not.toHaveBeenCalled();
    },
  );
});
