import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { BatchWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { addDays, fromLocal } from '../domain/time.js';
import { SCRIPTED_MOMENTS, simulatedDay } from '../demo/simulated-day.js';
import { putHousehold } from '../storage/household.js';
import { putDeviceHealth, putDeviceMapping } from '../storage/state.js';
import { documentClient, eventSortKey, tableNames, type TableNames } from '../storage/tables.js';
import { EVENT_RETENTION_DAYS } from '../storage/events.js';
import { jasmine } from '../testing/personas.js';

/**
 * Resets the simulated household for a new day. Scheduled just after midnight.
 *
 * This deletes data, so it refuses to run unless the deployment says it is a demo
 * (DEMO_RESET=enabled). A real household must never be reachable from here.
 *
 * Order matters:
 *   1. household config, with any pause a visitor left behind cleared
 *   2. delete the history window and the last week of assessments
 *   3. write six weeks of ordinary days, and today with the morning missing
 *   4. camera health covering today
 *   5. run the *deployed* assessment at 09:00, 10:45 and 12:30
 *
 * Step 5 invokes the real assess function rather than writing messages directly.
 * The three notifications are therefore produced the same way a real one would be:
 * baseline, assessment, notification policy, Bedrock, validation, SNS, stored record.
 */

interface ResetSummary {
  readonly today: string;
  readonly deletedEvents: number;
  readonly deletedAssessments: number;
  readonly writtenEvents: number;
  readonly notifications: readonly { minute: number; notified: boolean; severity: string | null }[];
}

/** Assessments older than this can still be found by "why did you message me". */
const ASSESSMENT_LOOKBACK_DAYS = 8;

async function keysBetween(
  tables: TableNames,
  pk: string,
  from: number,
  until: number,
): Promise<Record<string, unknown>[]> {
  const keys: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await documentClient().send(
      new QueryCommand({
        TableName: tables.events,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':from': eventSortKey(from, ''),
          ':to': eventSortKey(until - 1, '\uffff'),
        },
        ProjectionExpression: 'pk, sk',
        ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey }),
      }),
    );
    keys.push(...((page.Items ?? []) as Record<string, unknown>[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey !== undefined);
  return keys;
}

/** BatchWrite in 25s, retrying unprocessed items rather than silently dropping them. */
async function batchWrite(table: string, requests: Record<string, unknown>[]): Promise<number> {
  let done = 0;
  for (let i = 0; i < requests.length; i += 25) {
    let batch = requests.slice(i, i + 25);
    for (let attempt = 0; batch.length > 0; attempt += 1) {
      if (attempt === 6) throw new Error(`${batch.length} writes still unprocessed after retries`);
      const result = await documentClient().send(
        new BatchWriteCommand({ RequestItems: { [table]: batch } }),
      );
      const unprocessed = (result.UnprocessedItems?.[table] ?? []) as Record<string, unknown>[];
      done += batch.length - unprocessed.length;
      batch = unprocessed;
      if (batch.length > 0) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
  }
  return done;
}

export async function handler(): Promise<ResetSummary> {
  if (process.env['DEMO_RESET'] !== 'enabled') {
    throw new Error('DEMO_RESET is not enabled for this deployment; refusing to delete anything');
  }
  const tables = tableNames(process.env);
  const householdId = process.env['HOUSEHOLD_ID'];
  const assessFunction = process.env['ASSESS_FUNCTION_NAME'];
  if (householdId === undefined || assessFunction === undefined) {
    throw new Error('HOUSEHOLD_ID and ASSESS_FUNCTION_NAME must be set');
  }

  const persona = jasmine;
  const tz = persona.config.timeZone;
  const day = simulatedDay(persona, Date.now());

  // 1. Config. Rewriting it clears any pause a visitor set and forgot to lift.
  await putHousehold(tables, {
    householdId,
    residentName: process.env['RESIDENT_NAME'] ?? persona.name,
    timeZone: tz,
    interiorZones: persona.config.interiorZones,
    occupancySubjects: persona.config.occupancySubjects,
    quietFromMinute: persona.config.quietFromMinute,
    quietToMinute: persona.config.quietToMinute,
    suppressions: [],
    updatedAt: Date.now(),
  });

  // 2. Clear what this day replaces.
  const staleEvents = await keysBetween(tables, `household#${householdId}`, day.replaceFrom, day.replaceUntil);
  const staleAssessments = await keysBetween(
    tables,
    `assessment#${householdId}`,
    fromLocal(addDays(day.today, -ASSESSMENT_LOOKBACK_DAYS), 0, tz),
    day.replaceUntil,
  );
  const deletedEvents = await batchWrite(
    tables.events,
    staleEvents.map((Key) => ({ DeleteRequest: { Key } })),
  );
  const deletedAssessments = await batchWrite(
    tables.events,
    staleAssessments.map((Key) => ({ DeleteRequest: { Key } })),
  );

  // 3. History and today.
  const writtenEvents = await batchWrite(
    tables.events,
    day.events.map((event) => ({
      PutRequest: {
        Item: {
          pk: `household#${householdId}`,
          sk: eventSortKey(event.at, event.id),
          householdId,
          accountId: 'acct-simulated',
          requestId: `simulated-${event.id}`,
          ...event,
          expiresAt: Math.floor(event.at / 1000) + EVENT_RETENTION_DAYS * 86_400,
        },
      },
    })),
  );

  // 4. Devices and their health.
  for (const device of persona.devices) {
    await putDeviceMapping(tables, householdId, device.deviceId, device.zone);
  }
  for (const sample of day.health) {
    await putDeviceHealth(tables, householdId, sample);
  }

  // 5. The deployed assessment, at three moments.
  const lambda = new LambdaClient({});
  const notifications: { minute: number; notified: boolean; severity: string | null }[] = [];
  for (const minute of SCRIPTED_MOMENTS) {
    const response = await lambda.send(
      new InvokeCommand({
        FunctionName: assessFunction,
        Payload: Buffer.from(
          JSON.stringify({ evaluatedAt: fromLocal(day.today, minute, tz), householdId }),
        ),
      }),
    );
    if (response.FunctionError !== undefined) {
      throw new Error(`assessment at minute ${minute} failed: ${Buffer.from(response.Payload ?? []).toString()}`);
    }
    const result = JSON.parse(Buffer.from(response.Payload ?? []).toString()) as {
      notified: boolean;
      severity: string | null;
    };
    notifications.push({ minute, notified: result.notified, severity: result.severity });
  }

  const summary = {
    today: day.today,
    deletedEvents,
    deletedAssessments,
    writtenEvents,
    notifications,
  };
  console.log(JSON.stringify({ message: 'simulated household reset', householdId, ...summary }));
  return summary;
}
