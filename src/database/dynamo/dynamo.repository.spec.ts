import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { makeAppConfig } from '../../../test/support/app-config.js';
import { DynamoRepository, type IDynamoItem } from './dynamo.repository.js';
import { DynamoService } from './dynamo.service.js';

interface IEntry extends IDynamoItem {
  eventId: string;
}

class EntryRepository extends DynamoRepository<IEntry> {
  constructor(dynamo: DynamoService) {
    super(dynamo);
  }
}

function setup() {
  const dynamo = new DynamoService(
    makeAppConfig({
      DYNAMODB_ENDPOINT: 'http://127.0.0.1:8001',
      AWS_ACCESS_KEY_ID: 'local',
      AWS_SECRET_ACCESS_KEY: 'local',
      DYNAMODB_TABLE: 'unit_table',
    }),
  );
  const send = vi.fn();
  Object.defineProperty(dynamo, 'documentClient', { value: { send } });
  return { repository: new EntryRepository(dynamo), send };
}

describe('DynamoRepository', () => {
  it('writes with a condition that rejects an existing full key', async () => {
    const { repository, send } = setup();
    send.mockResolvedValue({});
    const item = { PK: 'DOCUMENT#1', SK: 't#e', eventId: 'e' };

    await repository.putIfNotExists(item);

    const command = send.mock.calls[0]?.[0] as PutCommand;
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input).toEqual({
      TableName: 'unit_table',
      Item: item,
      ConditionExpression: 'attribute_not_exists(PK)',
    });
  });

  it('forwards an abort signal to the SDK for writes and reads', async () => {
    const { repository, send } = setup();
    send.mockResolvedValue({});
    const { signal } = new AbortController();

    await repository.putIfNotExists(
      { PK: 'a', SK: 'b', eventId: 'e' },
      { abortSignal: signal },
    );
    await repository.getByKey('a', 'b', { abortSignal: signal });

    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal: signal });
    expect(send.mock.calls[1]?.[1]).toEqual({ abortSignal: signal });
  });

  it('preserves conditional write failures', async () => {
    const { repository, send } = setup();
    const failure = new ConditionalCheckFailedException({
      message: 'exists',
      $metadata: {},
    });
    send.mockRejectedValue(failure);

    await expect(
      repository.putIfNotExists({ PK: 'a', SK: 'b', eventId: 'e' }),
    ).rejects.toBe(failure);
  });

  it('reads by full key with a consistent read', async () => {
    const { repository, send } = setup();
    send.mockResolvedValue({ Item: { PK: 'a', SK: 'b', eventId: 'e' } });

    const item = await repository.getByKey('a', 'b');

    expect(item).toEqual({ PK: 'a', SK: 'b', eventId: 'e' });
    const command = send.mock.calls[0]?.[0] as GetCommand;
    expect(command).toBeInstanceOf(GetCommand);
    expect(command.input).toEqual({
      TableName: 'unit_table',
      Key: { PK: 'a', SK: 'b' },
      ConsistentRead: true,
    });
  });

  it('returns undefined when the key does not exist', async () => {
    const { repository, send } = setup();
    send.mockResolvedValue({});

    expect(await repository.getByKey('a', 'b')).toBeUndefined();
  });

  it('queries one partition in ascending order with an optional limit', async () => {
    const { repository, send } = setup();
    send.mockResolvedValue({ Items: [{ PK: 'a', SK: 'b', eventId: 'e' }] });

    const items = await repository.queryByPartition('a', { limit: 5 });

    expect(items).toHaveLength(1);
    const command = send.mock.calls[0]?.[0] as QueryCommand;
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toMatchObject({
      TableName: 'unit_table',
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'a' },
      ScanIndexForward: true,
      Limit: 5,
    });
  });

  it('returns an empty list when the partition has no items', async () => {
    const { repository, send } = setup();
    send.mockResolvedValue({});

    expect(await repository.queryByPartition('a')).toEqual([]);
  });
});
