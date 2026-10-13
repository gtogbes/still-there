#!/usr/bin/env node
/**
 * Produces today's notifications the honest way: by running the deployed assessment
 * at chosen moments of the morning.
 *
 * Each invocation is the real scheduled handler — it learns the baseline, assesses,
 * applies the notification policy, asks Bedrock to phrase the message, publishes to
 * SNS and stores the exact text. Nothing is written directly. Three moments are used
 * because the policy sends at most one message per severity level, so a broken
 * morning produces exactly three: low, medium, high.
 *
 * Afterwards the web app's demo clock can move through the morning and
 * explain_last_alert will find whichever message had been sent by then.
 *
 * Usage (after seed-household --history 42 --break-today):
 *   AWS_PROFILE=gt node dist/tools/seed-demo-alerts.mjs
 */

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { fromLocal, localParts } from '../src/domain/time.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || args[i + 1] === undefined ? fallback : args[i + 1];
};

const region = flag('region', 'us-east-1');
const stack = flag('stack', 'still-there-dev');
const householdId = flag('household', 'household-primary');
const timeZone = flag('tz', 'Europe/London');

const MOMENTS = [
  { label: '09:00', minute: 9 * 60 },
  { label: '10:45', minute: 10 * 60 + 45 },
  { label: '12:30', minute: 12 * 60 + 30 },
];

const lambda = new LambdaClient({ region });
const today = localParts(Date.now(), timeZone).dateKey;

console.log(`\nRunning the assessment at three moments on ${today}\n`);

for (const moment of MOMENTS) {
  const evaluatedAt = fromLocal(today, moment.minute, timeZone);
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: `${stack}-assess`,
      Payload: Buffer.from(JSON.stringify({ evaluatedAt, householdId })),
    }),
  );
  const result = JSON.parse(Buffer.from(response.Payload ?? new Uint8Array()).toString('utf8'));

  if (response.FunctionError !== undefined) {
    console.log(`  ${moment.label}  FAILED  ${result.errorMessage ?? 'unknown error'}`);
    continue;
  }

  const sent = result.notified ? `sent (${result.narrationSource})` : `not sent — ${result.notifyDecision}`;
  console.log(`  ${moment.label}  ${String(result.deviations).padStart(2)} overdue  ${String(result.severity ?? '-').padEnd(6)}  ${sent}`);
  if (result.notified) console.log(`         “${result.message}”`);
}

console.log('');
