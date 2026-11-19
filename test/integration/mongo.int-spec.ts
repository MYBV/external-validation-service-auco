import { type IndexDescription, ObjectId } from 'mongodb';
import { initializeMongo } from '../../src/database/init/initialize-mongo.js';
import { isDuplicateKeyError } from '../../src/database/mongo/mongo-errors.js';
import { MongoRepository } from '../../src/database/mongo/mongo.repository.js';
import { MongoService } from '../../src/database/mongo/mongo.service.js';
import {
  dropTestDatabase,
  loadIntegrationEnv,
} from '../support/integration-env.js';

interface IItem {
  _id: ObjectId;
  key: string;
}

interface IEvent {
  _id: ObjectId;
  itemKey: string;
}

class ItemRepository extends MongoRepository<IItem> {
  protected override readonly indexes: readonly IndexDescription[] = [
    { key: { key: 1 }, name: 'key_unique', unique: true },
  ];

  constructor(mongo: MongoService) {
    super(mongo, 'items');
  }
}

class EventRepository extends MongoRepository<IEvent> {
  constructor(mongo: MongoService) {
    super(mongo, 'events');
  }
}

describe('MongoDB infrastructure (real replica set)', () => {
  const { config } = loadIntegrationEnv();
  const mongo = new MongoService(config);
  const items = new ItemRepository(mongo);
  const events = new EventRepository(mongo);

  beforeAll(async () => {
    await mongo.onModuleInit();
    await initializeMongo(mongo, [items]);
  });

  afterAll(async () => {
    try {
      await dropTestDatabase(mongo);
    } finally {
      await mongo.onApplicationShutdown();
    }
  });

  it('is connected to the writable primary of a replica set', async () => {
    const hello = await mongo.db.admin().command({ hello: 1 });
    expect(hello['isWritablePrimary']).toBe(true);
    expect(hello['setName']).toBeDefined();
  });

  it('ensures indexes repeatedly without errors or duplicates', async () => {
    await initializeMongo(mongo, [items]);
    await initializeMongo(mongo, [items]);
    const indexes = await mongo.db.collection('items').indexes();
    expect(indexes.filter((index) => index.name === 'key_unique')).toHaveLength(
      1,
    );
  });

  it('creates and reads documents by id and by filter', async () => {
    const id = await items.create({ _id: new ObjectId(), key: 'read-me' });

    expect(await items.findById(id)).toEqual({ _id: id, key: 'read-me' });
    expect(await items.findOne({ key: 'read-me' })).toEqual({
      _id: id,
      key: 'read-me',
    });
    expect(await items.findById(new ObjectId())).toBeNull();
    expect(await items.findOne({ key: 'missing' })).toBeNull();
  });

  it('preserves the unique index violation (E11000)', async () => {
    await items.create({ _id: new ObjectId(), key: 'duplicate' });

    const error: unknown = await items
      .create({ _id: new ObjectId(), key: 'duplicate' })
      .catch((caught: unknown) => caught);

    expect(isDuplicateKeyError(error)).toBe(true);
  });

  it('commits every write of a transaction', async () => {
    const itemId = new ObjectId();
    const eventId = new ObjectId();

    await mongo.withTransaction(async (session) => {
      await items.create({ _id: itemId, key: 'committed' }, session);
      await events.create({ _id: eventId, itemKey: 'committed' }, session);
    });

    expect(await items.findById(itemId)).not.toBeNull();
    expect(await events.findById(eventId)).not.toBeNull();
  });

  it('rolls back every write when the transaction fails', async () => {
    const itemId = new ObjectId();
    const eventId = new ObjectId();
    const failure = new Error('simulated failure after both writes');

    const error: unknown = await mongo
      .withTransaction(async (session) => {
        await items.create({ _id: itemId, key: 'rolled-back' }, session);
        await events.create({ _id: eventId, itemKey: 'rolled-back' }, session);
        throw failure;
      })
      .catch((caught: unknown) => caught);

    expect(error).toBe(failure);
    expect(await items.findById(itemId)).toBeNull();
    expect(await events.findById(eventId)).toBeNull();
  });

  it('rolls back the whole transaction on a unique index violation', async () => {
    await items.create({ _id: new ObjectId(), key: 'taken' });
    const eventId = new ObjectId();

    const error: unknown = await mongo
      .withTransaction(async (session) => {
        await events.create({ _id: eventId, itemKey: 'taken' }, session);
        await items.create({ _id: new ObjectId(), key: 'taken' }, session);
      })
      .catch((caught: unknown) => caught);

    expect(isDuplicateKeyError(error)).toBe(true);
    expect(await events.findById(eventId)).toBeNull();
  });

  it('only exposes uncommitted writes to reads that use the session', async () => {
    await mongo.withTransaction(async (session) => {
      await items.create({ _id: new ObjectId(), key: 'isolated' }, session);

      expect(await items.findOne({ key: 'isolated' }, session)).not.toBeNull();
      expect(await items.findOne({ key: 'isolated' })).toBeNull();
    });

    expect(await items.findOne({ key: 'isolated' })).not.toBeNull();
  });
});
