#!/usr/bin/env node
/**
 * Sends a correctly signed Ring-shaped webhook at a live endpoint.
 *
 * This is the first thing that exercises the real path end to end: HMAC
 * verification, the v1.1 envelope adapter, deduplication and the DynamoDB write,
 * against deployed infrastructure rather than a test double. No camera needed.
 *
 * It also proves the negative case, which matters more. Pass --tamper and the body
 * is altered after signing, so a working endpoint must return 401. An endpoint that
 * accepts a tampered body would let anyone who found the URL feed us silence and
 * suppress every alert the product exists to send.
 *
 * Usage:
 *   node scripts/send-test-webhook.mjs <url> [--type motion_detected] [--subtype human]
 *                                            [--device dev-test-hallway] [--tamper]
 */

import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http'));
if (url === undefined) {
  console.error('usage: node scripts/send-test-webhook.mjs <url> [--type T] [--subtype S] [--device D] [--tamper]');
  process.exit(1);
}

const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || args[i + 1] === undefined ? fallback : args[i + 1];
};

const eventType = flag('type', 'motion_detected');
const subType = flag('subtype', 'human');
const deviceId = flag('device', 'dev-test-hallway');
const tamper = args.includes('--tamper');

function unquote(value) {
  const t = value.trim();
  if (t.length < 2) return t;
  const quoted = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  return quoted ? t.slice(1, -1).trim() : t;
}

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
let hmacKey = '';
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (t.startsWith('RING_HMAC_KEY=')) hmacKey = unquote(t.slice('RING_HMAC_KEY='.length));
}
if (hmacKey === '') {
  console.error('RING_HMAC_KEY not found in .env');
  process.exit(1);
}

const now = Date.now();
// A fixed request id lets the same delivery be replayed, which is how the
// deduplication path gets tested. Ring does this to us for real.
const requestId = flag('request-id', `test-${randomUUID()}`);
const payload = {
  meta: {
    version: '1.1',
    time: new Date(now).toISOString(),
    request_id: requestId,
    account_id: 'acct-local-test',
  },
  data: {
    id: `evt-${randomUUID()}`,
    type: eventType,
    ...(eventType === 'motion_detected' ? { subType } : {}),
    attributes: { source: deviceId, source_type: 'devices', timestamp: now },
    relationships: { devices: { links: { self: `/v1/devices/${deviceId}` } } },
  },
};

// Sign the exact bytes that will be sent. Serialise once and never re-stringify —
// key order and whitespace are part of the digest.
const body = JSON.stringify(payload);
const signature = createHmac('sha256', hmacKey).update(body, 'utf8').digest('hex');

const sent = tamper ? body.replace(deviceId, 'dev-someone-elses-camera') : body;

console.log(`POST ${url}`);
console.log(`  type=${eventType}${eventType === 'motion_detected' ? ` subType=${subType}` : ''} device=${deviceId}`);
console.log(`  request_id=${payload.meta.request_id}`);
if (tamper) console.log('  body altered after signing — a working endpoint must reject this');

const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
  body: sent,
  signal: AbortSignal.timeout(20_000),
});

const text = await response.text();
console.log(`\n  HTTP ${response.status}  ${text}`);

if (tamper) {
  if (response.status === 401) console.log('\n  ok — tampered body rejected');
  else console.log(`\n  FAIL — expected 401 for a tampered body, got ${response.status}`);
  process.exit(response.status === 401 ? 0 : 1);
}

if (response.status !== 200) {
  console.log(`\n  FAIL — expected 200, got ${response.status}`);
  process.exit(1);
}
console.log('\n  ok');
