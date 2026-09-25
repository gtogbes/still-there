#!/usr/bin/env node
/**
 * Drives the deployed stack, for the demonstration video.
 *
 * Everything here happens against real infrastructure: a signed webhook crosses the
 * internet into API Gateway, Lambda verifies the HMAC and writes to DynamoDB, the
 * scheduled assessment reads it back, and Bedrock phrases the result.
 *
 * The one liberty taken is asking the assessment about a chosen moment rather than
 * waiting for the day to pass. Nothing else is simulated — and that is possible only
 * because no code in src/domain reads the clock.
 *
 * Expects a seeded household:
 *   AWS_PROFILE=gt node dist/tools/seed-household.mjs --history 42 --break-today
 *
 * Usage:
 *   AWS_PROFILE=gt node dist/tools/demo-live.mjs --api https://xxxx.execute-api.us-east-1.amazonaws.com
 */

import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { addDays, fromLocal, localParts } from '../src/domain/time.ts';
import { ese } from '../src/testing/personas.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || args[i + 1] === undefined ? fallback : args[i + 1];
};

const api = flag('api', process.env['STILL_THERE_API'] ?? '');
const region = flag('region', 'us-east-1');
const stack = flag('stack', 'still-there-dev');
const householdId = flag('household', 'household-primary');

if (api === '') {
  console.error('pass --api https://<id>.execute-api.<region>.amazonaws.com');
  process.exit(1);
}

const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';
const GREEN = '\u001b[32m';
const AMBER = '\u001b[33m';
const CYAN = '\u001b[36m';
const bold = (s) => `${BOLD}${s}${RESET}`;
const dim = (s) => `${DIM}${s}${RESET}`;
const green = (s) => `${GREEN}${s}${RESET}`;
const amber = (s) => `${AMBER}${s}${RESET}`;
const cyan = (s) => `${CYAN}${s}${RESET}`;
const rule = () => console.log(dim('─'.repeat(74)));
const pause = (ms) =>
  process.env['DEMO_FAST'] === '1' ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

const lambda = new LambdaClient({ region });
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

const STATE_TABLE = `${stack}-state`;
const EVENTS_TABLE = `${stack}-events`;
const TZ = ese.config.timeZone;

function hmacKey() {
  // Resolved from the working directory, not from import.meta.url. This file is
  // bundled into dist/tools/, so a path relative to the module lands in dist/ and
  // misses .env entirely.
  const envPath = join(process.cwd(), '.env');
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('RING_HMAC_KEY=')) continue;
    let v = t.slice('RING_HMAC_KEY='.length).trim();
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
      v = v.slice(1, -1).trim();
    }
    return v;
  }
  throw new Error('RING_HMAC_KEY not found in .env');
}

const KEY = hmacKey();

async function sendWebhook(type, deviceId, extra = {}) {
  const now = Date.now();
  const payload = {
    meta: {
      version: '1.1',
      time: new Date(now).toISOString(),
      request_id: `demo-${randomUUID()}`,
      account_id: 'acct-demo',
    },
    data: {
      id: `evt-${randomUUID()}`,
      type,
      ...extra,
      attributes: { source: deviceId, source_type: 'devices', timestamp: now },
      relationships: { devices: { links: { self: `/v1/devices/${deviceId}` } } },
    },
  };
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', KEY).update(body, 'utf8').digest('hex');

  const response = await fetch(`${api}/ring/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
    body,
  });
  return { status: response.status, body: await response.text() };
}

async function askAt(dateKey, minute) {
  const evaluatedAt = fromLocal(dateKey, minute, TZ);
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: `${stack}-assess`,
      Payload: Buffer.from(JSON.stringify({ evaluatedAt, householdId })),
    }),
  );
  const raw = Buffer.from(response.Payload ?? new Uint8Array()).toString('utf8');
  return JSON.parse(raw);
}

/** Device health goes stale after 45 minutes, and a stale camera cannot witness anything. */
async function refreshHealth() {
  const now = Date.now();
  for (const device of ese.devices) {
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
}

async function countEvents() {
  const result = await doc.send(
    new QueryCommand({
      TableName: EVENTS_TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `household#${householdId}` },
      Select: 'COUNT',
    }),
  );
  return result.Count ?? 0;
}

function wrap(text, width, indent) {
  const out = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + word).length > width) {
      out.push(indent + line.trimEnd());
      line = '';
    }
    line += `${word} `;
  }
  if (line.trim() !== '') out.push(indent + line.trimEnd());
  return out;
}

// ────────────────────────────────────────────────────────────────────────────

const today = localParts(Date.now(), TZ).dateKey;

console.log(`\n${bold('StillThere')} ${dim('— live, against deployed infrastructure')}\n`);
rule();
console.log(`
${dim('API   ')} ${api}
${dim('Region')} ${region}
${dim('Today ')} ${today}

${dim('Every request below crosses the internet. The only thing simulated is which')}
${dim('moment we ask the assessment about — the rest is production.')}
`);
rule();

// 1. A signed event arrives

console.log(`\n${bold('[1/6]')} ${bold('A Ring-shaped event arrives, correctly signed')}`);
await pause(700);
const before = await countEvents();
const accepted = await sendWebhook('motion_detected', 'dev-hallway', { subType: 'human' });
console.log(dim(`      POST ${api}/ring/webhook`));
console.log(`      ${green(`HTTP ${accepted.status}`)} ${dim(accepted.body)}`);
await pause(1200);
const after = await countEvents();
console.log(dim(`      events stored: ${before} → ${after}`));
await pause(2000);

// 2. A tampered event is refused

console.log(`\n${bold('[2/6]')} ${bold('The same event, altered after signing')}`);
await pause(700);
const tamperNow = Date.now();
const tamperPayload = JSON.stringify({
  meta: { version: '1.1', time: new Date(tamperNow).toISOString(), request_id: `demo-${randomUUID()}`, account_id: 'acct-demo' },
  data: {
    id: `evt-${randomUUID()}`,
    type: 'motion_detected',
    subType: 'human',
    attributes: { source: 'dev-hallway', source_type: 'devices', timestamp: tamperNow },
  },
});
const goodSig = createHmac('sha256', KEY).update(tamperPayload, 'utf8').digest('hex');
const tampered = await fetch(`${api}/ring/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Signature': goodSig },
  body: tamperPayload.replace('dev-hallway', 'dev-somebody-elses'),
});
console.log(`      ${amber(`HTTP ${tampered.status}`)} ${dim(await tampered.text())}`);
console.log(
  dim(
    `      Without this, anyone who found the URL could feed us activity and\n` +
      `      silence every alert the product exists to send.`,
  ),
);
await pause(2500);

// 3. Ordinary morning

await refreshHealth();

console.log(`\n${bold('[3/6]')} ${bold("Ese hasn't come downstairs. Asking at 08:00")}`);
await pause(700);
const early = await askAt(today, 8 * 60);
console.log(
  `      deviations ${bold(String(early.deviations))}   ${early.deviations === 0 ? green('nothing to report') : amber('finding')}`,
);
console.log(
  dim(
    `      Her first activity is usually around half seven, but she varies.\n` +
      `      Nothing is overdue yet, and impatience here is how alerts get muted.`,
  ),
);
await pause(2500);

// 4. Now overdue

console.log(`\n${bold('[4/6]')} ${bold('Asking again at 09:30')}`);
await pause(700);
const mid = await askAt(today, 9 * 60 + 30);
console.log(`      deviations ${bold(String(mid.deviations))}   severity ${bold(String(mid.severity))}`);
for (const reason of mid.reasons.slice(0, 2)) {
  for (const line of wrap(reason, 66, '        ')) console.log(dim(line));
}
await pause(2800);

// 5. Escalated, and the message Bedrock writes

console.log(`\n${bold('[5/6]')} ${bold('Asking at 12:26')}`);
await pause(700);
const late = await askAt(today, 12 * 60 + 26);
console.log(
  `      deviations ${bold(String(late.deviations))}   severity ${bold(String(late.severity))}   narration ${bold(late.narrationSource)}`,
);
if (late.narrationRejection !== undefined) {
  // Surfaced rather than hidden. A silent fallback is how you end up shipping
  // deterministic text for a fortnight without noticing the model stopped working.
  console.log(`      ${amber(`model output not used: ${late.narrationRejection}`)}`);
}
console.log(`\n      ${bold('What her daughter receives:')}\n`);
for (const line of wrap(late.message, 62, '        ')) console.log(cyan(line));
console.log(`\n      ${dim(`Condensed by Bedrock from ${late.reasons.length} verified findings:`)}`);
for (const reason of late.reasons) {
  for (const line of wrap(reason, 66, '        ')) console.log(dim(line));
}
console.log(
  dim(
    `\n      The model only rewrites. It never decides whether to alert, and its output\n` +
      `      is checked before sending — speculation about health, any claim that footage\n` +
      `      was viewed, or a room we never assessed, and the verified text goes instead.`,
  ),
);
await pause(3500);

// 6. Withdrawal of consent

console.log(`\n${bold('[6/6]')} ${bold('Ese\u2019s daughter removes the integration in the Ring app')}`);
await pause(700);
const stored = await countEvents();
const revoked = await sendWebhook('app_integration_removed', 'dev-hallway');
console.log(`      ${green(`HTTP ${revoked.status}`)} ${dim(revoked.body)}`);
await pause(1500);
const remaining = await countEvents();
console.log(`      events stored: ${stored} → ${bold(String(remaining))}`);
console.log(
  dim(
    `\n      Tokens, history, learned routine, room assignments and past notifications.\n` +
      `      Deleted, not marked for expiry. Expiry is not erasure.`,
  ),
);

console.log('');
rule();
console.log(
  `\n${dim('Re-seed before running again:')}\n` +
    `${dim(`  AWS_PROFILE=$AWS_PROFILE node dist/tools/seed-household.mjs --history 42 --break-today`)}\n`,
);
