import {
  Inject,
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type ClientSession,
  type Db,
  MongoClient,
  type TransactionOptions,
} from 'mongodb';
import { APP_CONFIG, type IAppConfig } from '../../config/configuration.js';
import { type IMongoConfig, requireMongoConfig } from './mongo-config.js';

const TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'majority' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

/**
 * Owns the single MongoClient of the process. It connects when the module is
 * initialised (a failure aborts bootstrap) and closes on application shutdown.
 * It can also be constructed manually by scripts and tests.
 */
@Injectable()
export class MongoService implements OnModuleInit, OnApplicationShutdown {
  readonly client: MongoClient;
  readonly db: Db;

  constructor(@Inject(APP_CONFIG) appConfig: IAppConfig) {
    const config: IMongoConfig = requireMongoConfig(appConfig);
    this.client = new MongoClient(config.uri, {
      serverSelectionTimeoutMS: config.timeoutMs,
      connectTimeoutMS: config.timeoutMs,
    });
    this.db = this.client.db(config.dbName);
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.db.command({ ping: 1 });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }

  /**
   * Runs `work` inside a transaction (majority concern). The driver commits
   * when it resolves and aborts when it throws; the original error is
   * rethrown untouched. Transient errors make the driver re-run `work`, so it
   * must be idempotent: generate IDs and timestamps outside the callback.
   */
  async withTransaction<R>(
    work: (session: ClientSession) => Promise<R>,
  ): Promise<R> {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(
        () => work(session),
        TRANSACTION_OPTIONS,
      );
    } finally {
      await session.endSession();
    }
  }
}
