import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { documentClient, type TableNames } from './tables.js';
import { buildDeviceRegistry, type DeviceRegistry } from '../ring/devices.js';
import type { DeviceHealthSample } from '../domain/types.js';

/**
 * Deduplication window.
 *
 * Ring retries a delivery it did not hear back from within five seconds, so the
 * window only needs to outlast its retry schedule by a comfortable margin. A day
 * is generous and costs almost nothing.
 */
const DEDUP_TTL_SECONDS = 86_400;

/**
 * Records a request id, returning false if it has been seen before.
 *
 * A conditional put rather than read-then-write, so two concurrent deliveries of
 * the same event cannot both find it absent and both proceed. Ring warns that
 * duplicates happen, and a duplicated kitchen event is not harmless here — it is
 * a second piece of apparent evidence that somebody is up and about.
 */
export async function claimRequestId(
  tables: TableNames,
  requestId: string,
  now: number,
): Promise<boolean> {
  try {
    await documentClient().send(
      new PutCommand({
        TableName: tables.state,
        Item: {
          pk: `dedup#${requestId}`,
          sk: 'dedup',
          expiresAt: Math.floor(now / 1000) + DEDUP_TTL_SECONDS,
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw error;
  }
}

export interface TokenRecord {
  readonly accountId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch milliseconds when the access token stops working. */
  readonly accessExpiresAt: number;
  /** Epoch milliseconds the record was last written. */
  readonly updatedAt: number;
  /**
   * Set once a StillThere user has claimed this Ring account via nonce matching.
   * Until then the tokens are held but unattached.
   */
  readonly householdId?: string;
}

export async function putTokens(tables: TableNames, record: TokenRecord): Promise<void> {
  await documentClient().send(
    new PutCommand({
      TableName: tables.state,
      Item: { pk: `account#${record.accountId}`, sk: 'tokens', ...record },
    }),
  );
}

export async function getTokens(
  tables: TableNames,
  accountId: string,
): Promise<TokenRecord | undefined> {
  const result = await documentClient().send(
    new GetCommand({
      TableName: tables.state,
      Key: { pk: `account#${accountId}`, sk: 'tokens' },
    }),
  );
  return result.Item as TokenRecord | undefined;
}

/**
 * Records a pending account link.
 *
 * Ring hands the user a nonce and a timestamp, and the link is only completed once
 * a StillThere user signs in and presents the same nonce back. Short-lived on
 * purpose: Ring considers the request stale after ten minutes, so holding it any
 * longer only widens the window for a replayed link.
 */
export async function putPendingLink(
  tables: TableNames,
  nonce: string,
  issuedAt: number,
): Promise<void> {
  await documentClient().send(
    new PutCommand({
      TableName: tables.state,
      Item: {
        pk: `link#${nonce}`,
        sk: 'pending',
        issuedAt,
        expiresAt: Math.floor(issuedAt / 1000) + 900,
      },
    }),
  );
}

export interface DeviceMapping {
  readonly deviceId: string;
  readonly zone: string;
}

export async function deviceRegistryFor(
  tables: TableNames,
  householdId: string,
): Promise<DeviceRegistry> {
  const result = await documentClient().send(
    new QueryCommand({
      TableName: tables.state,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': `household#${householdId}`, ':prefix': 'device#' },
    }),
  );

  const mapping: Record<string, string> = {};
  for (const item of result.Items ?? []) {
    const row = item as unknown as DeviceMapping;
    if (typeof row.deviceId === 'string' && typeof row.zone === 'string') {
      mapping[row.deviceId] = row.zone;
    }
  }
  return buildDeviceRegistry(mapping);
}

export async function putDeviceMapping(
  tables: TableNames,
  householdId: string,
  deviceId: string,
  zone: string,
): Promise<void> {
  await documentClient().send(
    new PutCommand({
      TableName: tables.state,
      Item: { pk: `household#${householdId}`, sk: `device#${deviceId}`, deviceId, zone },
    }),
  );
}

/**
 * Device health is state, not history.
 *
 * An assessment asks "can I see this zone right now", which is the latest known
 * sample per device rather than a time series. Storing it alongside activity
 * events would also mean a camera going offline looked like something moving.
 */
export async function putDeviceHealth(
  tables: TableNames,
  householdId: string,
  sample: DeviceHealthSample,
): Promise<void> {
  try {
    await documentClient().send(
      new PutCommand({
        TableName: tables.state,
        Item: { pk: `household#${householdId}`, sk: `health#${sample.deviceId}`, ...sample },
        // Webhooks can arrive out of order, and an `offline` delivered after the
        // `online` that superseded it would leave us believing a working camera is
        // dead — which downgrades real deviations to "cannot confirm" and silences
        // the alert. Only ever move the sample forward in time.
        ConditionExpression: 'attribute_not_exists(lastSeenAt) OR lastSeenAt <= :at',
        ExpressionAttributeValues: { ':at': sample.lastSeenAt },
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return; // A newer sample already won. Nothing to do.
    }
    throw error;
  }
}

export async function deviceHealthFor(
  tables: TableNames,
  householdId: string,
): Promise<DeviceHealthSample[]> {
  const result = await documentClient().send(
    new QueryCommand({
      TableName: tables.state,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': `household#${householdId}`, ':prefix': 'health#' },
    }),
  );
  return (result.Items ?? []).map((item) => {
    const row = item as unknown as DeviceHealthSample;
    return {
      deviceId: row.deviceId,
      zone: row.zone,
      online: row.online,
      lastSeenAt: row.lastSeenAt,
      ...(typeof row.batteryPercent === 'number' ? { batteryPercent: row.batteryPercent } : {}),
    };
  });
}
