import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ActivityEvent } from '../domain/types.js';
import { documentClient, eventSortKey, householdKey, type TableNames } from './tables.js';

export interface StoredEvent extends ActivityEvent {
  readonly householdId: string;
  readonly accountId: string;
  readonly requestId: string;
  /** Unix seconds. DynamoDB deletes the row after this. */
  readonly expiresAt: number;
}

/**
 * How long activity history is kept.
 *
 * Long enough to learn a routine several times over, short enough that we are not
 * quietly accumulating a movement diary of somebody's home for years. Ninety days
 * covers the learning window with room for a household that goes away for a month.
 */
export const EVENT_RETENTION_DAYS = 90;

export function retentionTimestamp(at: number): number {
  return Math.floor(at / 1000) + EVENT_RETENTION_DAYS * 86_400;
}

export async function putEvent(
  tables: TableNames,
  householdId: string,
  accountId: string,
  requestId: string,
  event: ActivityEvent,
): Promise<void> {
  await documentClient().send(
    new PutCommand({
      TableName: tables.events,
      Item: {
        pk: householdKey(householdId),
        sk: eventSortKey(event.at, event.id),
        householdId,
        accountId,
        requestId,
        ...event,
        expiresAt: retentionTimestamp(event.at),
      },
    }),
  );
}

/**
 * Reads a window of a household's events.
 *
 * Paginates rather than trusting a single response, because a chatty household
 * with several cameras can exceed DynamoDB's 1MB page inside a single day, and a
 * truncated read would silently look like a quiet morning.
 */
export async function eventsBetween(
  tables: TableNames,
  householdId: string,
  fromInclusive: number,
  toExclusive: number,
): Promise<ActivityEvent[]> {
  const collected: ActivityEvent[] = [];
  let startKey: Record<string, unknown> | undefined;

  do {
    const page = await documentClient().send(
      new QueryCommand({
        TableName: tables.events,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': householdKey(householdId),
          ':from': eventSortKey(fromInclusive, ''),
          ':to': eventSortKey(toExclusive - 1, '\uffff'),
        },
        ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey }),
      }),
    );

    for (const item of page.Items ?? []) {
      const stored = item as unknown as StoredEvent;
      collected.push({
        id: stored.id,
        deviceId: stored.deviceId,
        zone: stored.zone,
        kind: stored.kind,
        at: stored.at,
        subject: stored.subject,
      });
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey !== undefined);

  return collected;
}
