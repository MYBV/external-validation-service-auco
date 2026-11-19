import {
  CreateTableCommand,
  DescribeTableCommand,
  type DynamoDBClient,
  ResourceInUseException,
  ResourceNotFoundException,
  type TableDescription,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';

const MAX_WAIT_SECONDS = 30;

export type EnsureTableResult = 'created' | 'exists';

function assertExpectedKeySchema(
  tableName: string,
  table: TableDescription | undefined,
): void {
  const keys = new Map(
    (table?.KeySchema ?? []).map((key) => [key.AttributeName, key.KeyType]),
  );
  const types = new Map(
    (table?.AttributeDefinitions ?? []).map((attribute) => [
      attribute.AttributeName,
      attribute.AttributeType,
    ]),
  );
  const matches =
    keys.size === 2 &&
    keys.get('PK') === 'HASH' &&
    keys.get('SK') === 'RANGE' &&
    types.get('PK') === 'S' &&
    types.get('SK') === 'S';
  if (!matches) {
    throw new Error(
      `DynamoDB table "${tableName}" exists with an unexpected key schema; expected string PK (HASH) and SK (RANGE)`,
    );
  }
}

async function describe(
  client: DynamoDBClient,
  tableName: string,
): Promise<TableDescription | undefined> {
  try {
    const { Table } = await client.send(
      new DescribeTableCommand({ TableName: tableName }),
    );
    return Table;
  } catch (error: unknown) {
    if (error instanceof ResourceNotFoundException) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Idempotent: creates the audit table when missing and otherwise only checks
 * its key schema. It never deletes or recreates a table.
 */
export async function ensureTable(
  client: DynamoDBClient,
  tableName: string,
): Promise<EnsureTableResult> {
  let result: EnsureTableResult = 'exists';
  if ((await describe(client, tableName)) === undefined) {
    try {
      await client.send(
        new CreateTableCommand({
          TableName: tableName,
          BillingMode: 'PAY_PER_REQUEST',
          AttributeDefinitions: [
            { AttributeName: 'PK', AttributeType: 'S' },
            { AttributeName: 'SK', AttributeType: 'S' },
          ],
          KeySchema: [
            { AttributeName: 'PK', KeyType: 'HASH' },
            { AttributeName: 'SK', KeyType: 'RANGE' },
          ],
        }),
      );
      result = 'created';
    } catch (error: unknown) {
      // A concurrent initialisation created it first: not an error.
      if (!(error instanceof ResourceInUseException)) {
        throw error;
      }
    }
  }

  await waitUntilTableExists(
    { client, maxWaitTime: MAX_WAIT_SECONDS },
    { TableName: tableName },
  );
  assertExpectedKeySchema(tableName, await describe(client, tableName));
  return result;
}
