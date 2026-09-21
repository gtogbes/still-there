import { putTokens } from '../storage/state.js';
import { tableNames } from '../storage/tables.js';
import { ringSecrets } from './secrets.js';

/**
 * Token Exchange endpoint.
 *
 * Ring POSTs an authorisation code here server-to-server when a user confirms the
 * integration. Three things about this flow are easy to get wrong and expensive to
 * debug, so they are called out where they happen:
 *
 *   1. The body is application/x-www-form-urlencoded, not JSON. Ring's own docs
 *      warn that JSON middleware fails silently — the code reads as undefined and
 *      the whole flow breaks with nothing obviously wrong.
 *   2. The code is valid for sixty seconds and single-use. There is no advance
 *      warning that it is coming, so this path cannot afford a cold start spent
 *      loading anything slow.
 *   3. The response goes to Ring, not to a user. Nobody sees it, so it carries no
 *      detail worth leaking.
 */

interface LambdaEvent {
  readonly body?: string;
  readonly isBase64Encoded?: boolean;
}

interface LambdaResponse {
  readonly statusCode: number;
  readonly headers?: Record<string, string>;
  readonly body: string;
}

const RING_TOKEN_PATH = '/oauth/token';

function decodeBody(event: LambdaEvent): string {
  if (event.body === undefined) return '';
  return event.isBase64Encoded === true
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const secretArn = process.env['RING_SECRET_ARN'];
  const oauthBase = process.env['RING_OAUTH_BASE_URL'] ?? 'https://oauth.ring.com';
  const apiBase = process.env['RING_API_BASE_URL'] ?? 'https://api.amazonvision.com';
  if (secretArn === undefined) {
    console.error('RING_SECRET_ARN must be set');
    return { statusCode: 500, body: JSON.stringify({ error: 'misconfigured' }) };
  }

  // Form-encoded, emphatically not JSON.
  const params = new URLSearchParams(decodeBody(event));
  const code = params.get('code');
  if (code === null || code === '') {
    console.error('token exchange called with no code', {
      keysReceived: [...params.keys()].join(', ') || '(none)',
    });
    return { statusCode: 400, body: JSON.stringify({ error: 'missing code' }) };
  }

  const tables = tableNames(process.env);
  const secrets = await ringSecrets(secretArn);

  // Sixty-second budget, so fail fast rather than hanging on a stalled socket.
  const exchange = await fetch(`${oauthBase}${RING_TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: secrets.clientId,
      client_secret: secrets.clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!exchange.ok) {
    // Deliberately not logging the body — it can echo the code back.
    console.error('Ring rejected the token exchange', { status: exchange.status });
    return { statusCode: 502, body: JSON.stringify({ error: 'exchange failed' }) };
  }

  const tokens = (await exchange.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
    console.error('token response missing access or refresh token');
    return { statusCode: 502, body: JSON.stringify({ error: 'malformed token response' }) };
  }

  // The account id is how webhook events are later attributed to this user, and
  // how the nonce gets matched when they finish signing in. Without it the tokens
  // are unusable, so a failure here is fatal to the link.
  const profile = await fetch(`${apiBase}/v1/users/me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!profile.ok) {
    console.error('could not read the Ring account id', { status: profile.status });
    return { statusCode: 502, body: JSON.stringify({ error: 'profile lookup failed' }) };
  }
  const profileBody = (await profile.json()) as { data?: { id?: string } };
  const accountId = profileBody.data?.id;
  if (typeof accountId !== 'string' || accountId === '') {
    console.error('Ring profile had no data.id');
    return { statusCode: 502, body: JSON.stringify({ error: 'no account id' }) };
  }

  const now = Date.now();
  // Stored without a householdId: held, but not yet attached to a StillThere user.
  // The nonce exchange on the Account Link path is what claims it.
  await putTokens(tables, {
    accountId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessExpiresAt: now + (tokens.expires_in ?? 14_400) * 1000,
    updatedAt: now,
  });

  console.log('stored unclaimed Ring tokens', { accountId });
  return { statusCode: 200, body: JSON.stringify({ status: 'ok' }) };
}
