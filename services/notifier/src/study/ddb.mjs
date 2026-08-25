/**
 * Minimal DynamoDB access for the study table.
 *
 * Two jobs, deliberately kept together because they are the whole of the
 * project's DynamoDB surface: hand-written attribute-value marshalling, and a
 * lazily-imported client.
 *
 * There is no `@aws-sdk/lib-dynamodb` or `util-dynamodb` here. Only
 * `@aws-sdk/client-ssm` is confirmed present in the nodejs22.x runtime bundle
 * (config.mjs relies on it), so the convenience wrappers are treated as absent
 * rather than assumed. Adding them means reopening ADR 0001 first.
 *
 * The client is imported inside the call, not at module load, so the local
 * scripts and the test suite can import this file with no AWS SDK and no
 * credentials -- the same pattern config.mjs uses.
 */

/** Convert a plain JS value to a DynamoDB AttributeValue. */
export function marshall(value) {
  if (value === null || value === undefined) return { NULL: true };
  if (typeof value === 'string') return { S: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`cannot marshall ${value}`);
    return { N: String(value) };
  }
  if (typeof value === 'boolean') return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(marshall) };
  if (typeof value === 'object') {
    return { M: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, marshall(v)])) };
  }
  throw new TypeError(`cannot marshall ${typeof value}`);
}

/** Convert a DynamoDB AttributeValue back to a plain JS value. */
export function unmarshall(attr) {
  if (attr == null) return undefined;
  if ('NULL' in attr) return null;
  if ('S' in attr) return attr.S;
  // Numbers come back as strings on the wire; DynamoDB's range exceeds
  // Number.MAX_SAFE_INTEGER, but nothing here stores an id that large.
  if ('N' in attr) return Number(attr.N);
  if ('BOOL' in attr) return attr.BOOL;
  if ('L' in attr) return attr.L.map(unmarshall);
  if ('M' in attr) {
    return Object.fromEntries(Object.entries(attr.M).map(([k, v]) => [k, unmarshall(v)]));
  }
  throw new TypeError(`cannot unmarshall ${JSON.stringify(attr)}`);
}

/** Marshall an object's values, leaving the keys alone. */
export const marshallItem = (obj) =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, marshall(v)]));

/** Unmarshall a whole item. */
export const unmarshallItem = (item) =>
  item ? Object.fromEntries(Object.entries(item).map(([k, v]) => [k, unmarshall(v)])) : undefined;

let cachedClient;

async function client() {
  if (!cachedClient) {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    cachedClient = new DynamoDBClient({});
  }
  return cachedClient;
}

/** Query one partition. `expressionValues` takes plain JS values. */
export async function query(table, { indexName, keyCondition, expressionValues, limit }) {
  const { QueryCommand } = await import('@aws-sdk/client-dynamodb');
  const db = await client();
  const out = await db.send(
    new QueryCommand({
      TableName: table,
      IndexName: indexName,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: marshallItem(expressionValues),
      Limit: limit,
    }),
  );
  return (out.Items ?? []).map(unmarshallItem);
}

/** Write one item. `item` takes plain JS values. */
export async function putItem(table, item) {
  const { PutItemCommand } = await import('@aws-sdk/client-dynamodb');
  const db = await client();
  await db.send(new PutItemCommand({ TableName: table, Item: marshallItem(item) }));
}
