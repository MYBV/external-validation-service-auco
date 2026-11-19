import type { ICountry } from '../../src/countries/interfaces/country.interface.js';
import { CountryRepository } from '../../src/countries/repositories/country.repository.js';
import {
  CountriesService,
  UnsupportedCountryException,
} from '../../src/countries/services/countries.service.js';
import { initializeMongo } from '../../src/database/init/initialize-mongo.js';
import { isDuplicateKeyError } from '../../src/database/mongo/mongo-errors.js';
import { MongoService } from '../../src/database/mongo/mongo.service.js';
import {
  dropTestDatabase,
  loadIntegrationEnv,
} from '../support/integration-env.js';

describe('Countries catalog (real MongoDB)', () => {
  const { config } = loadIntegrationEnv();
  const mongo = new MongoService(config);
  const repository = new CountryRepository(mongo);
  const service = new CountriesService(repository);

  beforeAll(async () => {
    await mongo.onModuleInit();
    await initializeMongo(mongo, [repository]);
    await service.seed();
  });

  afterAll(async () => {
    try {
      await dropTestDatabase(mongo);
    } finally {
      await mongo.onApplicationShutdown();
    }
  });

  const all = () =>
    mongo.db
      .collection<ICountry>('countries')
      .find({}, { sort: { code: 1 } })
      .toArray();

  it('ensures the unique code index without duplicates', async () => {
    await initializeMongo(mongo, [repository]);
    const indexes = await mongo.db.collection('countries').indexes();
    const unique = indexes.filter((index) => index.name === 'code_unique');
    expect(unique).toHaveLength(1);
    expect(unique[0]?.unique).toBe(true);
  });

  it('seeds CO and MX once and never modifies existing documents', async () => {
    expect((await all()).map((country) => country.code)).toEqual(['CO', 'MX']);

    await mongo.db
      .collection('countries')
      .updateOne(
        { code: 'MX' },
        { $set: { enabled: false, name: 'Changed manually' } },
      );
    const before = await all();

    expect(await service.seed()).toBe(0);
    expect(await service.seed()).toBe(0);

    expect(await all()).toEqual(before);
  });

  it('rejects a duplicate code (E11000)', async () => {
    const error: unknown = await repository
      .create({
        code: 'CO',
        name: 'Duplicate',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .catch((caught: unknown) => caught);

    expect(isDuplicateKeyError(error)).toBe(true);
  });

  it('validates countries against the catalog', async () => {
    await expect(service.assertEnabled('co')).resolves.toMatchObject({
      code: 'CO',
    });
    await expect(service.assertEnabled('ZZ')).rejects.toMatchObject({
      reason: 'NOT_FOUND',
    });
    // MX was disabled manually by a previous test.
    const disabled: unknown = await service
      .assertEnabled('MX')
      .catch((error: unknown) => error);
    expect(disabled).toBeInstanceOf(UnsupportedCountryException);
    expect((disabled as UnsupportedCountryException).reason).toBe('DISABLED');
  });
});
