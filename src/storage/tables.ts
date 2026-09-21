import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Two tables, deliberately.
 *
 * `events` is the rolling activity history — append-only, one row per Ring event,
 * partitioned by household and sorted by time so an assessment reads a single
 * day with one query.
 *
 * `state` holds everything else: OAuth tokens, device-to-zone mappings, and the
 * deduplication markers. Small, keyed, unrelated to time.
 *
 * Kept apart because their lifecycles differ. Events expire on a retention clock
 * and are written constantly; tokens are written rarely and must never expire by
 * accident. One table with a TTL attribute shared between them is a good way to
 * delete somebody's refresh token at three in the morning.
 */

let cached: DynamoDBDocumentClient | undefined;

export function documentClient(): DynamoDBDocumentClient {
  if (cached === undefined) {
    cached = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return cached;
}

export interface TableNames {
  readonly events: string;
  readonly state: string;
}

export function tableNames(env: Record<string, string | undefined>): TableNames {
  const events = env['EVENTS_TABLE'];
  const state = env['STATE_TABLE'];
  if (events === undefined || state === undefined) {
    throw new Error('EVENTS_TABLE and STATE_TABLE must be set');
  }
  return { events, state };
}

/** Partition key for a household's event stream. */
export function householdKey(householdId: string): string {
  return `household#${householdId}`;
}

/**
 * Sort key for an event.
 *
 * Zero-padded so lexical ordering matches chronological ordering, with the event
 * id appended because two sensors can fire in the same millisecond and the later
 * one must not overwrite the earlier.
 */
export function eventSortKey(at: number, eventId: string): string {
  return `${String(at).padStart(15, '0')}#${eventId}`;
}
