#!/usr/bin/env node
/**
 * Seeds a household into DynamoDB: config, device-to-zone mappings, and optionally
 * a synthetic activity history.
 *
 * The history matters because the product compares today against weeks of learned
 * habit, and there is no way to wait six weeks to find out whether the deployed
 * assessment works. This writes Ese's routine — the same persona the offline test
 * suite uses — straight into the events table, so the Lambda reasons over real
 * stored rows rather than a fixture.
 *
 * Honest about what it proves and does not. It proves storage, querying, baseline
 * learning and assessment all work against live infrastructure. It proves nothing
 * about Ring, because no Ring event is involved.
 *
 * Usage:
 *   AWS_PROFILE=gt node scripts/seed-household.mjs --config-only
 *   AWS_PROFILE=gt node scripts/seed-household.mjs --history 42
 *   AWS_PROFILE=gt node scripts/seed-household.mjs --history 42 --break-today
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ese } from '../src/testing/personas.ts';
import { generateHistory } from '../src/testing/generator.ts';
import { addDays, fromLocal, localParts } from '../src/domain/time.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || args[i + 1] === undefined ? fallback : args[i + 1];
};

const region = flag('region', 'us-east-1');
const stack = flag('stack', 'still-there-dev');
const householdId = flag('household', 'household-primary');
const historyDays = Number(flag('history', '0'));
const configOnly = args.includes('--config-only');
const breakToday = args.includes('--break-today');

const EVENTS_TABLE = `${stack}-events`;
const STATE_TABLE = `${stack}-state`;
const RETENTION_DAYS = 90;

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

// ── Household config ─────────────────────────────────────────────────────────

const config = {
  householdId,
  // Optional in the data model, and worth setting: without it the notification says
  // "the resident", which reads like a case file rather than somebody's mother.
  residentName: ese.name,
  timeZone: ese.config.timeZone,
  interiorZones: ese.config.interiorZones,
  occupancySubjects: ese.config.occupancySubjects,
  quietFromMinute: ese.config.quietFromMinute,
  quietToMinute: ese.config.quietToMinute,
  suppressions: [],
  updatedAt: Date.now(),
};

await doc.send(
  new PutCommand({
    TableName: STATE_TABLE,
    Item: { pk: `household#${householdId}`, sk: 'config', ...config },
  }),
);
console.log(`config written: timezone ${config.timeZone}, interior ${config.interiorZones.join('/')}`);
console.log(`  occupancy accepts: ${config.occupancySubjects.join(', ')}`);

// ── Device mappings and health ───────────────────────────────────────────────

const now = Date.now();
for (const device of ese.devices) {
  await doc.send(
    new PutCommand({
      TableName: STATE_TABLE,
      Item: {
        pk: `household#${householdId}`,
        sk: `device#${device.deviceId}`,
        deviceId: device.deviceId,
        zone: device.zone,
      },
    }),
  );
  // Every camera awake and reporting a minute ago. Without this the assessment
  // correctly refuses to call anything a deviation, because it cannot establish
  // that anything was watching.
  await doc.send(
    new PutCommand({
      TableName: STATE_TABLE,
      Item: {
        pk: `household#${householdId}`,
        sk: `health#${device.deviceId}`,
        deviceId: device.deviceId,
        zone: device.zone,
        online: true,
        lastSeenAt: now - 60_000,
        batteryPercent: 84,
      },
    }),
  );
}
console.log(`${ese.devices.length} devices mapped and marked online`);

if (configOnly || historyDays === 0) {
  console.log('\nconfig only, no history written\n');
  process.exit(0);
}

// ── Synthetic history ────────────────────────────────────────────────────────

const today = localParts(now, config.timeZone).dateKey;
const startDateKey = addDays(today, -historyDays);

// Learning window: the days before today, all normal.
const history = generateHistory(ese, {
  startDateKey,
  days: historyDays,
  seed: 20260925,
});

// Today, separately, so it can be deliberately broken.
const todayEvents = generateHistory(ese, {
  startDateKey: today,
  days: 1,
  seed: 999,
  ...(breakToday ? { omit: () => true } : {}),
});

// Clear today before rewriting it. Event sort keys include a timestamp and an id,
// so a re-seed would land alongside the previous run rather than replacing it — and
// a "broken" today seeded on top of a normal one still looks perfectly normal, which
// is a confusing way to conclude the detector is broken.
const startOfToday = fromLocal(today, 0, config.timeZone);
const startOfTomorrow = fromLocal(addDays(today, 1), 0, config.timeZone);

const existingToday = await doc.send(
  new QueryCommand({
    TableName: EVENTS_TABLE,
    KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
    ExpressionAttributeValues: {
      ':pk': `household#${householdId}`,
      ':from': `${String(startOfToday).padStart(15, '0')}#`,
      ':to': `${String(startOfTomorrow - 1).padStart(15, '0')}#\uffff`,
    },
    ProjectionExpression: 'pk, sk',
  }),
);

const stale = existingToday.Items ?? [];
for (let i = 0; i < stale.length; i += 25) {
  await doc.send(
    new BatchWriteCommand({
      RequestItems: {
        [EVENTS_TABLE]: stale.slice(i, i + 25).map((key) => ({ DeleteRequest: { Key: key } })),
      },
    }),
  );
}
if (stale.length > 0) console.log(`cleared ${stale.length} existing events for today`);

const all = [...history, ...todayEvents];

const rows = all.map((event) => ({
  PutRequest: {
    Item: {
      pk: `household#${householdId}`,
      sk: `${String(event.at).padStart(15, '0')}#${event.id}`,
      householdId,
      accountId: 'acct-seeded',
      requestId: `seed-${event.id}`,
      ...event,
      expiresAt: Math.floor(event.at / 1000) + RETENTION_DAYS * 86_400,
    },
  },
}));

// BatchWrite caps at 25 items, and unprocessed items come back rather than
// throwing — a loop that ignores them silently loses rows.
let written = 0;
for (let i = 0; i < rows.length; i += 25) {
  let batch = rows.slice(i, i + 25);
  for (let attempt = 0; attempt < 5 && batch.length > 0; attempt += 1) {
    const response = await doc.send(new BatchWriteCommand({ RequestItems: { [EVENTS_TABLE]: batch } }));
    written += batch.length;
    const unprocessed = response.UnprocessedItems?.[EVENTS_TABLE] ?? [];
    if (unprocessed.length === 0) break;
    written -= unprocessed.length;
    batch = unprocessed;
    await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
  }
}

console.log(`\n${written} events written across ${historyDays} days of history plus today`);
console.log(`  history: ${startDateKey} to ${addDays(today, -1)}`);
console.log(`  today:   ${today}${breakToday ? '  — ROUTINE DELIBERATELY BROKEN' : '  (normal)'}`);
console.log(
  breakToday
    ? '\nExpect the assessment to report deviations.\n'
    : '\nExpect the assessment to report nothing. Silence is the correct result.\n',
);
