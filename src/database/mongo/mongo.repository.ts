import type {
  ClientSession,
  Collection,
  Document,
  Filter,
  IndexDescription,
  InferIdType,
  OptionalUnlessRequiredId,
  WithId,
} from 'mongodb';
import type { MongoService } from './mongo.service.js';

/**
 * Minimal base for MongoDB repositories. Concrete repositories own their
 * collection name, their indexes and every domain query. Driver errors
 * (duplicate keys, write conflicts) are never caught or wrapped here.
 */
export abstract class MongoRepository<T extends Document> {
  /** Concrete repositories override this with their index definitions. */
  protected readonly indexes: readonly IndexDescription[] = [];

  protected readonly collection: Collection<T>;

  protected constructor(mongo: MongoService, collectionName: string) {
    this.collection = mongo.db.collection<T>(collectionName);
  }

  async create(
    document: OptionalUnlessRequiredId<T>,
    session?: ClientSession,
  ): Promise<InferIdType<T>> {
    const result = await this.collection.insertOne(document, { session });
    return result.insertedId;
  }

  async findById(
    id: InferIdType<T>,
    session?: ClientSession,
  ): Promise<WithId<T> | null> {
    return this.collection.findOne({ _id: id } as Filter<T>, { session });
  }

  async findOne(
    filter: Filter<T>,
    session?: ClientSession,
  ): Promise<WithId<T> | null> {
    return this.collection.findOne(filter, { session });
  }

  /**
   * Creates the declared indexes. Idempotent: existing identical indexes are
   * left untouched, nothing is dropped, and a conflicting definition surfaces
   * the driver error.
   */
  async ensureIndexes(): Promise<void> {
    if (this.indexes.length === 0) {
      return;
    }
    await this.collection.createIndexes([...this.indexes]);
  }
}
