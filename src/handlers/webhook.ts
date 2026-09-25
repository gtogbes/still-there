import { classifyRingPayload } from '../ring/classify.js';
import { SIGNATURE_HEADER, verifyWebhookSignature } from '../ring/webhook.js';
import { eraseAccount } from '../storage/erase.js';
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

  // The routing decision lives in classifyRingPayload, as a pure function with its
  // own tests. It used to be inline here and had a bug that no test could reach
  // while it was entangled with DynamoDB and Secrets Manager.
  const classified = classifyRingPayload(payload, registry);

  switch (classified.kind) {
    case 'activity': {
      const { event: activity, context } = classified.activity;
      if (!(await claimRequestId(tables, context.requestId, Date.now()))) {
        return ok('duplicate');
      }
      await putEvent(tables, householdId, context.accountId, context.requestId, activity);
      return ok('recorded');
    }

    case 'health': {
      const { sample, context } = classified.health;
      if (!(await claimRequestId(tables, context.requestId, Date.now()))) {
        return ok('duplicate');
      }
      // Health is latest-known state per device, not history. Writing it onto the
      // activity stream would make a camera dropping offline look like movement.
      await putDeviceHealth(tables, householdId, sample);
      return ok('device status recorded');
    }

    case 'revocation': {
      const { accountId, context } = classified.revocation;
      if (!(await claimRequestId(tables, context.requestId, Date.now()))) {
        return ok('duplicate');
      }

      const report = await eraseAccount(tables, accountId, householdId);

      // Logged without the account id. Recording that an erasure happened is
      // necessary; keeping an identifier for the person who asked to be forgotten
      // rather defeats the exercise.
      console.log(
        JSON.stringify({
          message: 'consent withdrawn, household erased',
          eventsDeleted: report.eventsDeleted,
          stateRowsDeleted: report.stateRowsDeleted,
          assessmentsDeleted: report.assessmentsDeleted,
          partial: report.partial,
        }),
      );

      if (report.partial) {
        // A 500 makes Ring retry, and the erasure is safe to repeat — anything
        // already deleted simply is not found the second time.
        console.error('erasure incomplete, asking Ring to retry');
        return { statusCode: 500, body: JSON.stringify({ status: 'erasure incomplete' }) };
      }

      return ok('erased');
    }

    case 'uninterpretable':
      // Logged loudly because it means Ring's payload shape has moved, or ours has.
      // Still a 200: a retry produces the identical failure, and a retry storm is
      // worse than a loss we have already recorded.
      console.error('could not interpret signed Ring payload', { reason: classified.reason });
      return ok('uninterpretable');

    case 'ignored':
      console.log('ignored Ring event', { reason: classified.reason });
      return ok('ignored');
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
