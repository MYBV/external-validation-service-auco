import {
  CreateTableCommand,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';
import { ensureTable } from '../../src/database/dynamo/dynamo-table.js';
import { isConditionalCheckFailed } from '../../src/database/dynamo/dynamo-errors.js';
import {
  DynamoRepository,
  type IDynamoItem,
} from '../../src/database/dynamo/dynamo.repository.js';
import { DynamoService } from '../../src/database/dynamo/dynamo.service.js';
import {
  deleteTestTable,
  loadIntegrationEnv,
  newResourceName,
} from '../support/integration-env.js';

interface IAuditItem extends IDynamoItem {
  eventId: string;
}

class AuditItemRepository extends DynamoRepository<IAuditItem> {
  constructor(dynamo: DynamoService) {
    super(dynamo);
  }
}

describe('DynamoDB infrastructure (DynamoDB Local)', () => {
  const { config } = loadIntegrationEnv();
  const dynamo = new DynamoService(config);
  const repository = new AuditItemRepository(dynamo);
  const extraTables: string[] = [];

  beforeAll(async () => {
    expect(await ensureTable(dynamo.client, dynamo.tableName)).toBe('created');
  });

  afterAll(async () => {
    try {
      await deleteTestTable(dynamo);
      for (const tableName of extraTables) {
        await deleteTestTable(dynamo, tableName);
      }
    } finally {
      dynamo.onApplicationShutdown();
    }
  });

  it('lists the isolated test table', async () => {
    const { TableNames } = await dynamo.client.send(new ListTablesCommand({}));
    expect(TableNames).toContain(dynamo.tableName);
  });

  it('writes an item only once per full key and preserves the conditional error', async () => {
    const item = { PK: 'DOCUMENT#A', SK: '2026-01-01T00:00:00.000Z#e1' };
    await repository.putIfNotExists({ ...item, eventId: 'e1' });

    const error: unknown = await repository
      .putIfNotExists({ ...item, eventId: 'different' })
      .catch((caught: unknown) => caught);

    expect(isConditionalCheckFailed(error)).toBe(true);
    expect(await repository.getByKey(item.PK, item.SK)).toEqual({
      ...item,
      eventId: 'e1',
    });
  });

  it('returns undefined for a missing key', async () => {
    expect(
      await repository.getByKey('DOCUMENT#NONE', 'missing'),
    ).toBeUndefined();
  });

  it('queries a partition in ascending sort key order and honours limit', async () => {
    const pk = 'DOCUMENT#B';
    const sks = [
      '2026-01-01T00:00:03.000Z#c',
      '2026-01-01T00:00:01.000Z#a',
      '2026-01-01T00:00:02.000Z#b',
    ];
    for (const sk of sks) {
      await repository.putIfNotExists({ PK: pk, SK: sk, eventId: sk });
    }
    await repository.putIfNotExists({
      PK: 'DOCUMENT#OTHER',
      SK: '2026-01-01T00:00:00.000Z#z',
      eventId: 'z',
    });

    const all = await repository.queryByPartition(pk);
    const limited = await repository.queryByPartition(pk, { limit: 2 });

    expect(all.map((entry) => entry.SK)).toEqual([...sks].sort());
    expect(limited.map((entry) => entry.SK)).toEqual(
      [...sks].sort().slice(0, 2),
    );
  });

  it('ensureTable is idempotent and keeps existing data', async () => {
    const outcome = await ensureTable(dynamo.client, dynamo.tableName);

    expect(outcome).toBe('exists');
    expect(
      await repository.getByKey('DOCUMENT#A', '2026-01-01T00:00:00.000Z#e1'),
    ).toBeDefined();
  });

  it('refuses an existing table with a different key schema without altering it', async () => {
    const tableName = newResourceName();
    extraTables.push(tableName);
    await dynamo.client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      }),
    );

    await expect(ensureTable(dynamo.client, tableName)).rejects.toThrow(
      /unexpected key schema/,
    );
  });
});
