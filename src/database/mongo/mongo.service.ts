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

const BASE_TRANSACTION_OPTIONS: TransactionOptions = {
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
  private readonly transactionOptions: TransactionOptions;

  constructor(@Inject(APP_CONFIG) appConfig: IAppConfig) {
    const config: IMongoConfig = requireMongoConfig(appConfig);
    this.client = new MongoClient(config.uri, {
      serverSelectionTimeoutMS: config.timeoutMs,
      connectTimeoutMS: config.timeoutMs,
    });
    this.db = this.client.db(config.dbName);
    // withTransaction({ timeoutMS }) is a no-op in the installed driver, so the
    // only supported bound is the server-side commit time.
    this.transactionOptions = {
      ...BASE_TRANSACTION_OPTIONS,
      maxCommitTimeMS: config.timeoutMs,
    };
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
   *
   * The commit is bounded by maxCommitTimeMS (MONGO_TIMEOUT_MS). When it
   * expires the driver does not retry and raises an error labelled
   * UnknownTransactionCommitResult: the transaction MAY have been committed,
   * so callers must reconcile instead of assuming a rollback. The rest of the
   * transaction is not time-bounded (the driver only stops retrying after
   * 120 s) and the request timeout does not cancel it.
   */
  async withTransaction<R>(
    work: (session: ClientSession) => Promise<R>,
  ): Promise<R> {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(
        () => work(session),
        this.transactionOptions,
      );
    } finally {
      await session.endSession();
    }
  }
}
