import type { Collection, IndexDescription } from 'mongodb';
import { makeAppConfig } from '../../../test/support/app-config.js';
import { MongoRepository } from './mongo.repository.js';
import { MongoService } from './mongo.service.js';

interface IThing {
  name: string;
}

class IndexedRepository extends MongoRepository<IThing> {
  protected override readonly indexes: readonly IndexDescription[] = [
    { key: { name: 1 }, name: 'name_unique', unique: true },
  ];

  constructor(mongo: MongoService) {
    super(mongo, 'things');
  }

  get raw(): Collection<IThing> {
    return this.collection;
  }
}

class PlainRepository extends MongoRepository<IThing> {
  constructor(mongo: MongoService) {
    super(mongo, 'plain');
  }

  get raw(): Collection<IThing> {
    return this.collection;
  }
}

const mongo = new MongoService(
  makeAppConfig({ MONGO_URI: 'mongodb://127.0.0.1:27018' }),
);

describe('MongoRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the collection named by the concrete repository', () => {
    expect(new IndexedRepository(mongo).raw.collectionName).toBe('things');
  });

  it('creates the declared indexes without touching existing ones', async () => {
    const repository = new IndexedRepository(mongo);
    const createIndexes = vi
      .spyOn(repository.raw, 'createIndexes')
      .mockResolvedValue([]);
    const dropIndexes = vi.spyOn(repository.raw, 'dropIndexes');

    await repository.ensureIndexes();
    await repository.ensureIndexes();

    expect(createIndexes).toHaveBeenCalledTimes(2);
    expect(createIndexes).toHaveBeenCalledWith([
      { key: { name: 1 }, name: 'name_unique', unique: true },
    ]);
    expect(dropIndexes).not.toHaveBeenCalled();
  });

  it('does nothing when the repository declares no indexes', async () => {
    const repository = new PlainRepository(mongo);
    const createIndexes = vi.spyOn(repository.raw, 'createIndexes');

    await repository.ensureIndexes();

    expect(createIndexes).not.toHaveBeenCalled();
  });

  it('does not wrap driver errors', async () => {
    const repository = new PlainRepository(mongo);
    const failure = new Error('driver failure');
    vi.spyOn(repository.raw, 'insertOne').mockRejectedValue(failure);

    await expect(repository.create({ name: 'x' })).rejects.toBe(failure);
  });
});
