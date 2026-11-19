import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoService } from './dynamo.service.js';

/** Every item of the table uses string `PK` / `SK` keys. */
export interface IDynamoItem {
  readonly PK: string;
  readonly SK: string;
}

/** Optional per-call settings. An aborted call leaves its outcome ambiguous. */
export interface IDynamoCallOptions {
  readonly abortSignal?: AbortSignal;
}

/**
 * Minimal base for DynamoDB repositories. Concrete repositories build keys and
 * payloads. Service errors (including ConditionalCheckFailedException) are
 * never caught or wrapped here. Date values are not supported by the document
 * client: store ISO strings.
 */
export abstract class DynamoRepository<T extends IDynamoItem> {
  protected constructor(protected readonly dynamo: DynamoService) {}

  /**
   * Writes the item only if its full key does not exist yet. There is
   * deliberately no unconditional put: items are immutable.
   */
  async putIfNotExists(
    item: T,
    options: IDynamoCallOptions = {},
  ): Promise<void> {
    await this.dynamo.documentClient.send(
      new PutCommand({
        TableName: this.dynamo.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
      { abortSignal: options.abortSignal },
    );
  }

  async getByKey(
    pk: string,
    sk: string,
    options: IDynamoCallOptions = {},
  ): Promise<T | undefined> {
    const result = await this.dynamo.documentClient.send(
      new GetCommand({
        TableName: this.dynamo.tableName,
        Key: { PK: pk, SK: sk },
        ConsistentRead: true,
      }),
      { abortSignal: options.abortSignal },
    );
    // DynamoDB items are untyped; concrete repositories own their shape.
    return result.Item as T | undefined;
  }

  /** Items of one partition in ascending SK order. No pagination: use `limit`. */
  async queryByPartition(
    pk: string,
    options: { readonly limit?: number } = {},
  ): Promise<T[]> {
    const result = await this.dynamo.documentClient.send(
      new QueryCommand({
        TableName: this.dynamo.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ScanIndexForward: true,
        ConsistentRead: true,
        Limit: options.limit,
      }),
    );
    return (result.Items ?? []) as T[];
  }
}
