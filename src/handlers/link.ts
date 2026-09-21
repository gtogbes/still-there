import { putPendingLink } from '../storage/state.js';
import { tableNames } from '../storage/tables.js';

/**
 * Account Link endpoint.
 *
 * Ring sends the user's browser here with `nonce` and `time` query parameters when
 * they choose to connect the integration. Our job is to check the request is fresh,
 * remember the nonce, and hand the user on to sign in.
 *
 * Scoped down deliberately. A production version needs a real sign-in surface,
 * because this is the point where a StillThere account gets attached to a Ring
 * account. For a private app with a single user that is one credential, not a user
 * table — but it is the piece that most obviously needs replacing before anyone
 * else could use this.
 */

/** Ring treats a link request older than ten minutes as stale. */
const FRESHNESS_WINDOW_MS = 600_000;

interface LambdaEvent {
  readonly queryStringParameters?: Record<string, string | undefined> | null;
}

interface LambdaResponse {
  readonly statusCode: number;
  readonly headers?: Record<string, string>;
  readonly body: string;
}

function problem(status: number, message: string): LambdaResponse {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: message,
  };
}

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const signInUrl = process.env['SIGN_IN_URL'];
  if (signInUrl === undefined) {
    console.error('SIGN_IN_URL must be set');
    return problem(500, 'This integration is not configured correctly.');
  }

  const nonce = event.queryStringParameters?.['nonce'];
  const time = event.queryStringParameters?.['time'];
  if (nonce === undefined || nonce === '' || time === undefined || time === '') {
    return problem(400, 'This link is missing information. Please start again from the Ring app.');
  }

  const issuedAt = Number(time);
  if (!Number.isFinite(issuedAt)) {
    return problem(400, 'This link is malformed. Please start again from the Ring app.');
  }

  // Both directions matter. Too old is a stale or replayed link; dated in the
  // future means clock skew or tampering, and neither should be honoured.
  const age = Date.now() - issuedAt;
  if (age > FRESHNESS_WINDOW_MS || age < -FRESHNESS_WINDOW_MS) {
    console.warn('rejected a stale or skewed link request', { ageMs: age });
    return problem(400, 'This link has expired. Please start again from the Ring app.');
  }

  await putPendingLink(tableNames(process.env), nonce, issuedAt);

  // Carry the nonce forward so the sign-in page can present it back and claim the
  // tokens the Token Exchange endpoint has already stored.
  const destination = new URL(signInUrl);
  destination.searchParams.set('nonce', nonce);
  destination.searchParams.set('time', time);

  return {
    statusCode: 302,
    headers: {
      Location: destination.toString(),
      // A redirect carrying a nonce should never sit in a shared cache.
      'Cache-Control': 'no-store',
    },
    body: '',
  };
}
