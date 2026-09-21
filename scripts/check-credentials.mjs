#!/usr/bin/env node
/**
 * Validates .env without revealing any of it.
 *
 * Two passes. The first checks shape locally — present, non-empty, free of the
 * quoting and whitespace damage that copy-paste from a web portal causes. The
 * second optionally asks Ring whether the client credentials are real.
 *
 * That second check works by deliberately presenting an invalid authorization
 * code. Ring's OAuth server distinguishes the two failures, which is exactly what
 * we need:
 *
 *   invalid_client  →  the Client ID or Secret is wrong
 *   invalid_grant   →  credentials accepted, the code was rejected (expected)
 *
 * So an `invalid_grant` is a pass. The credentials reach only oauth.ring.com,
 * which is the party they were issued by and for.
 *
 * Usage:
 *   node scripts/check-credentials.mjs           # local shape checks only
 *   node scripts/check-credentials.mjs --live    # also probe Ring's OAuth server
 */

import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env');

const REQUIRED = ['RING_CLIENT_ID', 'RING_CLIENT_SECRET', 'RING_HMAC_KEY'];

function parseEnv(text) {
  const values = new Map();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    values.set(line.slice(0, eq).trim(), line.slice(eq + 1));
  }
  return values;
}

let failures = 0;
let warnings = 0;

const pass = (message) => console.log(`  ok    ${message}`);
const warn = (message) => {
  warnings += 1;
  console.log(`  warn  ${message}`);
};
const fail = (message) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};

let raw;
try {
  raw = await readFile(envPath, 'utf8');
} catch {
  console.log(`\n  FAIL  no .env at ${envPath}`);
  console.log('        cp .env.example .env and fill in the three credentials\n');
  process.exit(1);
}

const env = parseEnv(raw);

console.log('\nLocal shape checks\n');

for (const key of REQUIRED) {
  const value = env.get(key);
  if (value === undefined) {
    fail(`${key} is absent`);
    continue;
  }
  if (value.trim() === '') {
    fail(`${key} is empty`);
    continue;
  }
  // Quotes are the classic copy-paste injury. A secret wrapped in quotes fails
  // signature verification in a way that looks exactly like an attack.
  if (/^["'].*["']$/.test(value.trim())) {
    fail(`${key} is wrapped in quotes — remove them, .env needs none`);
    continue;
  }
  if (value !== value.trim()) {
    warn(`${key} has surrounding whitespace (the loader trims, but tidy it up)`);
  }
  if (/\s/.test(value.trim())) {
    fail(`${key} contains an internal space — likely a truncated paste`);
    continue;
  }
  pass(`${key} present (${value.trim().length} chars)`);
}

const environment = (env.get('RING_ENVIRONMENT') ?? 'sandbox').trim();
if (environment === 'sandbox' || environment === 'production') {
  pass(`RING_ENVIRONMENT is '${environment}'`);
  if (environment === 'production') {
    warn('pointing at production — sandbox is the safer default while building');
  }
} else {
  fail(`RING_ENVIRONMENT must be 'sandbox' or 'production', found '${environment}'`);
}

// Self-consistency only. Proves the key is usable for HMAC, not that it is the
// right key — nothing local can prove that.
const hmacKey = (env.get('RING_HMAC_KEY') ?? '').trim();
if (hmacKey !== '') {
  const digest = createHmac('sha256', hmacKey).update('probe', 'utf8').digest('hex');
  if (digest.length === 64) pass('RING_HMAC_KEY produces a valid SHA-256 digest');
  else fail('RING_HMAC_KEY did not produce a 64-character hex digest');
}

if (!process.argv.includes('--live')) {
  console.log(
    `\n${failures} failure(s), ${warnings} warning(s). Re-run with --live to verify the credentials against Ring.\n`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

if (failures > 0) {
  console.log('\nSkipping the live probe — fix the shape problems above first.\n');
  process.exit(1);
}

console.log('\nLive probe against oauth.ring.com\n');

const oauthBase = (env.get('RING_OAUTH_BASE_URL') ?? 'https://oauth.ring.com').trim();
const body = new URLSearchParams({
  grant_type: 'authorization_code',
  code: 'still-there-credential-probe-not-a-real-code',
  client_id: (env.get('RING_CLIENT_ID') ?? '').trim(),
  client_secret: (env.get('RING_CLIENT_SECRET') ?? '').trim(),
});

try {
  const response = await fetch(`${oauthBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON error bodies are informative too, just not structured.
  }
  const code = typeof parsed.error === 'string' ? parsed.error : '(no error field)';

  console.log(`  HTTP ${response.status}, error='${code}'`);

  if (code === 'invalid_grant') {
    pass('credentials accepted — the bad code was rejected, which is the pass condition');
  } else if (code === 'invalid_client' || response.status === 401) {
    fail('Ring rejected the Client ID or Secret. Check for a truncated paste.');
  } else if (response.status === 200) {
    warn('unexpected success against a fake code — inspect the response by hand');
  } else {
    warn(`inconclusive. Response body (first 300 chars):\n        ${text.slice(0, 300)}`);
  }
} catch (error) {
  warn(`could not reach ${oauthBase}: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(`\n${failures} failure(s), ${warnings} warning(s).\n`);
process.exit(failures > 0 ? 1 : 0);
