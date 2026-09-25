import { adaptActivityEvent, adaptDeviceHealth } from '../ring/adapter.js';
import { SIGNATURE_HEADER, verifyWebhookSignature } from '../ring/webhook.js';
import { putEvent } from '../storage/events.js';
import { claimRequestId, deviceRegistryFor, putDeviceHealth } from '../storage/state.js';
import { tableNames } from '../storage/tables.js';
import { ringSecrets } from './secrets.js';

/**
 * Ring webhook receiver.
 *
 * Ring expects a 2xx within five seconds and retries otherwise, so this function
 * does the minimum: verify the signature, work out what the event is, write it
 * down, acknowledge. No baseline learning, no assessment, no model calls — those
 * run on a schedule against stored events, because a slow inference call here
 * would turn into duplicate deliveries.
 *
 * Note the response codes. Ring is told 200 even for a payload we could not parse,
 * because retrying will not help and a retry storm is worse than a lost event we
 * have already logged. Only a genuine failure on our side returns 500, where a
 * retry might actually succeed.
 */

interface LambdaEvent {
  readonly body?: string;
  readonly headers?: Record<string, string | undefined>;
  readonly isBase64Encoded?: boolean;
}

interface LambdaResponse {
  readonly statusCode: number;
  readonly body: string;
}

const ok = (detail: string): LambdaResponse => ({
  statusCode: 200,
  body: JSON.stringify({ status: detail }),
});

function header(headers: Record<string, string | undefined> | undefined, name: string) {
  if (headers === undefined) return undefined;
  // API Gateway lower-cases header names for HTTP APIs, but not universally
  // across integrations, so match case-insensitively rather than trusting it.
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return match === undefined ? undefined : headers[match];
}

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const secretArn = process.env['RING_SECRET_ARN'];
  const householdId = process.env['HOUSEHOLD_ID'];
  if (secretArn === undefined || householdId === undefined) {
    console.error('RING_SECRET_ARN and HOUSEHOLD_ID must be set');
    return { statusCode: 500, body: JSON.stringify({ status: 'misconfigured' }) };
  }

  // The signature covers the exact bytes Ring sent. Decoding base64 is fine;
  // parsing and re-serialising the JSON is not, and would fail every request.
  const raw =
    event.isBase64Encoded === true && event.body !== undefined
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : (event.body ?? '');

  let secrets;
  let tables;
  try {
    secrets = await ringSecrets(secretArn);
    tables = tableNames(process.env);
  } catch (error) {
    console.error('failed to load configuration', { message: describe(error) });
    return { statusCode: 500, body: JSON.stringify({ status: 'misconfigured' }) };
  }

  const verification = verifyWebhookSignature(
    raw,
    header(event.headers, SIGNATURE_HEADER),
    secrets.hmacKey,
  );
  if (!verification.valid) {
    // 401 rather than 200. This is the one case where we want Ring to stop and
    // where an operator should look — an unsigned request either means our key is
    // wrong or somebody is probing the endpoint.
    console.warn('rejected unsigned webhook', { reason: verification.reason });
    return { statusCode: 401, body: JSON.stringify({ status: 'invalid signature' }) };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.error('signed payload was not JSON', { bytes: raw.length });
    return ok('unparseable');
  }

  const registry = await deviceRegistryFor(tables, householdId);

  // Order matters, and an earlier version got it wrong. Both adapters were run and
  // the result only treated as uninterpretable if *both* said 'invalid' — but the
  // health adapter answers 'ignored' for anything that is not a status event, which
  // masked the activity adapter's 'invalid' and quietly swallowed genuinely unknown
  // event types as "ignored". That is precisely the silence the strict adapter
  // exists to prevent.
  //
  // adaptActivityEvent already returns 'ignored' for device status types, so its
  // verdict is authoritative: 'invalid' means nobody can read this payload.
  const activity = adaptActivityEvent(payload, registry);

  if (activity.outcome === 'invalid') {
    // Logged loudly because it means Ring's payload shape has moved, or ours has.
    // Still a 200: a retry produces the identical failure, and a retry storm is
    // worse than a loss we have already recorded.
    console.error('could not interpret signed Ring payload', { reason: activity.reason });
    return ok('uninterpretable');
  }

  if (activity.outcome === 'ok') {
    const fresh = await claimRequestId(tables, activity.value.context.requestId, Date.now());
    if (!fresh) {
      return ok('duplicate');
    }
    await putEvent(
      tables,
      householdId,
      activity.value.context.accountId,
      activity.value.context.requestId,
      activity.value.event,
    );
    return ok('recorded');
  }

  const health = adaptDeviceHealth(payload, registry);
  if (health.outcome === 'ok') {
    const fresh = await claimRequestId(tables, health.value.context.requestId, Date.now());
    if (!fresh) return ok('duplicate');
    // Health is latest-known state per device, not history. Writing it onto the
    // activity stream would make a camera dropping offline look like movement.
    await putDeviceHealth(tables, householdId, health.value.sample);
    return ok('device status recorded');
  }

  if (health.outcome === 'invalid') {
    console.error('could not interpret signed device status payload', {
      reason: health.reason,
    });
    return ok('uninterpretable');
  }

  // Understood, and deliberately not acted on. Subscription changes, door
  // closures, unplaced devices.
  console.log('ignored Ring event', { reason: activity.reason });
  return ok('ignored');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
