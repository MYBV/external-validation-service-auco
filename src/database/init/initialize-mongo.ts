import type { MongoService } from '../mongo/mongo.service.js';

/** Anything that owns MongoDB indexes, normally a MongoRepository subclass. */
export interface IIndexedRepository {
  ensureIndexes(): Promise<void>;
}

/**
 * Idempotent, non-destructive MongoDB initialisation: verifies that the node
 * is the writable primary of a replica set (transactions require it) and
 * ensures the indexes of every given repository. It never starts the replica
 * set: Docker Compose does that.
 */
export async function initializeMongo(
  mongo: MongoService,
  repositories: readonly IIndexedRepository[],
): Promise<void> {
  const hello = await mongo.db.admin().command({ hello: 1 });
  if (hello['setName'] === undefined || hello['isWritablePrimary'] !== true) {
    throw new Error(
      'MongoDB must be the writable primary of a replica set for transactions',
    );
  }
  for (const repository of repositories) {
    await repository.ensureIndexes();
  }
}
