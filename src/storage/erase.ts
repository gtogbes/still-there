import { BatchWriteCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { documentClient, householdKey, type TableNames } from './tables.js';

/**
 * Erases everything held about a household.
 *
 * Runs when Ring tells us a user removed the integration. At that moment we are
 * holding a record of when somebody moved around their own home, and the only basis
 * we had for holding it has been withdrawn. The landing page says we delete it; this
 * is the code that makes that true.
 *
 * Deliberately thorough rather than minimal. It would be defensible to delete only
 * the OAuth tokens and let the ninety-day expiry quietly handle the rest, and it
 * would also mean keeping months of somebody's movements after they asked us to
 * stop. Expiry is not erasure.
 *
 * Ordered so the destructive part happens before the part that stops new data
 * arriving would be pointless — tokens first, because once those are gone we cannot
 * receive anything new even if the rest fails halfway.
 */

export interface ErasureReport {
  readonly tokensDeleted: number;
  readonly eventsDeleted: number;
  readonly stateRowsDeleted: number;
  readonly assessmentsDeleted: number;
  readonly partial: boolean;
}

/** DynamoDB accepts 25 writes per batch. */
const BATCH = 25;

async function deleteAllUnder(
  table: string,
  partitionKey: string,
): Promise<{ deleted: number; partial: boolean }> {
  let deleted = 0;
  let partial = false;
  let startKey: Record<string, unknown> | undefined;

  do {
    const page = await documentClient().send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': partitionKey },
        ProjectionExpression: 'pk, sk',
        ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey }),
      }),
    );

    const keys = page.Items ?? [];
    for (let i = 0; i < keys.length; i += BATCH) {
      const slice = keys.slice(i, i + BATCH);
      let pending = slice.map((key) => ({ DeleteRequest: { Key: key } }));

      // Unprocessed items come back rather than throwing, so a loop that ignores
      // them reports a successful erasure while leaving rows behind.
      for (let attempt = 0; attempt < 5 && pending.length > 0; attempt += 1) {
        const response = await documentClient().send(
          new BatchWriteCommand({ RequestItems: { [table]: pending } }),
        );
        deleted += pending.length;
        const unprocessed = (response.UnprocessedItems?.[table] ?? []) as typeof pending;
        deleted -= unprocessed.length;
        pending = unprocessed;
        if (pending.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
        }
      }
      if (pending.length > 0) partial = true;
    }

    startKey = page.LastEvaluatedKey;
  } while (startKey !== undefined);

  return { deleted, partial };
}

export async function eraseAccount(
  tables: TableNames,
  accountId: string,
  householdId: string,
): Promise<ErasureReport> {
  // Tokens first. Once these are gone Ring cannot be called on this user's behalf,
  // so even a failure later in this function cannot leave us able to read more.
  await documentClient().send(
    new DeleteCommand({
      TableName: tables.state,
      Key: { pk: `account#${accountId}`, sk: 'tokens' },
    }),
  );

  // Activity history, device map, health, household config, assessments.
  const activity = await deleteAllUnder(tables.events, householdKey(householdId));
  const state = await deleteAllUnder(tables.state, householdKey(householdId));
  const assessments = await deleteAllUnder(tables.events, `assessment#${householdId}`);

  return {
    tokensDeleted: 1,
    eventsDeleted: activity.deleted,
    stateRowsDeleted: state.deleted,
    assessmentsDeleted: assessments.deleted,
    partial: activity.partial || state.partial || assessments.partial,
  };
}
