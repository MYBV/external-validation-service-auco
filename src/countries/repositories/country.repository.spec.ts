import type { Collection } from 'mongodb';
import { makeAppConfig } from '../../../test/support/app-config.js';
import { MongoService } from '../../database/mongo/mongo.service.js';
import type { ICountry } from '../interfaces/country.interface.js';
import { CountryRepository } from './country.repository.js';

const mongo = new MongoService(
  makeAppConfig({ MONGO_URI: 'mongodb://127.0.0.1:27018' }),
);

function rawCollection(repository: CountryRepository): Collection<ICountry> {
  return (repository as unknown as { collection: Collection<ICountry> })
    .collection;
}

describe('CountryRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the countries collection and declares the unique code index', async () => {
    const repository = new CountryRepository(mongo);
    const collection = rawCollection(repository);
    const createIndexes = vi
      .spyOn(collection, 'createIndexes')
      .mockResolvedValue([]);

    await repository.ensureIndexes();

    expect(collection.collectionName).toBe('countries');
    expect(createIndexes).toHaveBeenCalledWith([
      { key: { code: 1 }, name: 'code_unique', unique: true },
    ]);
  });

  it('seeds with $setOnInsert and upsert only, never overwriting', async () => {
    const repository = new CountryRepository(mongo);
    const updateOne = vi
      .spyOn(rawCollection(repository), 'updateOne')
      .mockResolvedValueOnce({ upsertedCount: 1 } as never)
      .mockResolvedValueOnce({ upsertedCount: 0 } as never);

    const inserted = await repository.seed([
      { code: 'CO', name: 'Colombia', enabled: true },
      { code: 'MX', name: 'Mexico', enabled: true },
    ]);

    expect(inserted).toBe(1);
    expect(updateOne).toHaveBeenCalledTimes(2);
    const filters = updateOne.mock.calls.map(([filter]) => filter);
    expect(filters).toEqual([{ code: 'CO' }, { code: 'MX' }]);
    for (const [, update, options] of updateOne.mock.calls) {
      expect(Object.keys(update)).toEqual(['$setOnInsert']);
      expect(options).toEqual({ upsert: true });
    }
  });

  it('does not wrap driver errors', async () => {
    const repository = new CountryRepository(mongo);
    const failure = new Error('driver failure');
    vi.spyOn(rawCollection(repository), 'findOne').mockRejectedValue(failure);

    await expect(repository.findByCode('CO')).rejects.toBe(failure);
  });
});
