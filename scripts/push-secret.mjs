#!/usr/bin/env node
/**
 * Copies the Ring credentials from .env into Secrets Manager.
 *
 * Uses the SDK rather than shelling out to the AWS CLI, and that is a scar rather
 * than a preference. The first version of this script passed a `fileb://`
 * reference on the command line; the CLI rejected the byte type and echoed the
 * entire decoded payload — client id, client secret and HMAC key — into its error
 * output, where it was promptly captured and displayed.
 *
 * Two lessons, both encoded here: secrets never travel as process arguments, and
 * error paths need the same care as success paths. Nothing below prints, returns or
 * re-throws anything derived from the payload.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

const secretId = process.argv[2];
const region = process.argv[3] ?? 'us-east-1';

if (secretId === undefined) {
  console.error('usage: node scripts/push-secret.mjs <secret-id> [region]');
  process.exit(1);
}

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const quoted = (first === '"' && last === '"') || (first === "'" && last === "'");
  return quoted ? trimmed.slice(1, -1).trim() : trimmed;
}

const env = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  env[trimmed.slice(0, eq).trim()] = unquote(trimmed.slice(eq + 1));
}

const payload = {
  clientId: env['RING_CLIENT_ID'],
  clientSecret: env['RING_CLIENT_SECRET'],
  hmacKey: env['RING_HMAC_KEY'],
};

for (const [key, value] of Object.entries(payload)) {
  if (typeof value !== 'string' || value === '') {
    console.error(`.env is missing a usable value for ${key}`);
    process.exit(1);
  }
}

const client = new SecretsManagerClient({ region });

try {
  const result = await client.send(
    new PutSecretValueCommand({
      SecretId: secretId,
      SecretString: JSON.stringify(payload),
    }),
  );
  console.log(`secret updated, version ${result.VersionId ?? '(unknown)'}`);
} catch (error) {
  // Only the error's name and message. An SDK error can carry the request body on
  // some paths, and dumping the whole object is how the payload leaked last time.
  const name = error instanceof Error ? error.name : 'UnknownError';
  const message = error instanceof Error ? error.message : 'no detail';
  console.error(`failed to update secret: ${name}: ${message}`);
  process.exit(1);
}
