import type { DynamoService } from '../dynamo/dynamo.service.js';
import type { MongoService } from '../mongo/mongo.service.js';

const { ensureTable } = vi.hoisted(() => ({ ensureTable: vi.fn() }));
vi.mock('../dynamo/dynamo-table.js', () => ({ ensureTable }));

const { initializeMongo } = vi.hoisted(() => ({ initializeMongo: vi.fn() }));
vi.mock('./initialize-mongo.js', () => ({ initializeMongo }));

const { updateOne } = vi.hoisted(() => ({
  updateOne:
    vi.fn<
      (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => Promise<{ upsertedCount: number }>
    >(),
}));

import { initializeInfrastructure } from './initialize-infrastructure.js';

function fakes() {
  const mongo = {
    db: { collection: () => ({ updateOne }) },
    onModuleInit: vi.fn().mockResolvedValue(undefined),
    onApplicationShutdown: vi.fn().mockResolvedValue(undefined),
  };
  const dynamo = {
    client: {},
    tableName: 'validation_audit',
    onApplicationShutdown: vi.fn(),
  };
  const logger = { log: vi.fn() };
  return {
    mongo,
    dynamo,
    logger,
    run: () =>
      initializeInfrastructure(
        mongo as unknown as MongoService,
        dynamo as unknown as DynamoService,
        logger,
      ),
  };
}

describe('initializeInfrastructure', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    initializeMongo.mockResolvedValue(undefined);
    ensureTable.mockResolvedValue('exists');
  });

  it('ensures indexes, seeds CO and MX only, and ensures the table', async () => {
    updateOne.mockResolvedValue({ upsertedCount: 1 });
    const { run, mongo, dynamo, logger } = fakes();

    await run();

    expect(initializeMongo).toHaveBeenCalledOnce();
    const [, repositories] = initializeMongo.mock.calls[0] as [
      unknown,
      unknown[],
    ];
    expect(repositories).toHaveLength(1);
    const seeded = updateOne.mock.calls.map(([filter]) => filter);
    expect(seeded).toEqual([{ code: 'CO' }, { code: 'MX' }]);
    for (const [, update, options] of updateOne.mock.calls) {
      expect(Object.keys(update)).toEqual(['$setOnInsert']);
      expect(options).toEqual({ upsert: true });
    }
    expect(ensureTable).toHaveBeenCalledWith(dynamo.client, 'validation_audit');
    expect(mongo.onModuleInit).toHaveBeenCalledOnce();
    expect(logger.log).toHaveBeenCalledWith(
      'MongoDB: countries seed inserted 2 new entries',
    );
  });

  it('is repeatable: a second run inserts nothing and fails nowhere', async () => {
    updateOne.mockResolvedValue({ upsertedCount: 0 });
    const { run, logger } = fakes();

    await run();
    await run();

    expect(logger.log).toHaveBeenCalledWith(
      'MongoDB: countries seed inserted 0 new entries',
    );
  });

  it('releases both clients even when a step fails, preserving the error', async () => {
    const failure = new Error('not a replica set primary');
    initializeMongo.mockRejectedValue(failure);
    const { run, mongo, dynamo } = fakes();

    await expect(run()).rejects.toBe(failure);

    expect(updateOne).not.toHaveBeenCalled();
    expect(ensureTable).not.toHaveBeenCalled();
    expect(mongo.onApplicationShutdown).toHaveBeenCalledOnce();
    expect(dynamo.onApplicationShutdown).toHaveBeenCalledOnce();
  });
});
