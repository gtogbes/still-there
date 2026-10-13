import { createHash, timingSafeEqual } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

/**
 * Shared access code for the demo endpoints.
 *
 * Two endpoints need this. `/mcp` exposes `pause_monitoring`, which writes — without
 * a check, anyone who found the URL could switch off a welfare monitor. And
 * `/api/assistant` calls Bedrock on every request, so leaving it open is an
 * invitation to run up a bill.
 *
 * Deliberately simple, and honest about it: one code, held in Secrets Manager,
 * given to judges in the testing instructions. A real product would sign each
 * family in. This is enough to stop a stranger, and no more than that.
 *
 * The MCP specification makes authorisation optional for HTTP servers and describes
 * an OAuth flow when it is used. A static bearer code is outside that flow; it is
 * here as a cost and abuse control, not as a claim of spec-compliant authorisation.
 */

let cached: string | undefined;
let client: SecretsManagerClient | undefined;

async function expectedCode(secretArn: string): Promise<string> {
  if (cached !== undefined) return cached;
  client ??= new SecretsManagerClient({});
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const value = (response.SecretString ?? '').trim();
  if (value === '') throw new Error('access code secret is empty');
  cached = value;
  return value;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** The bearer code a request presented, if any. Used to forward it, never to log it. */
export function presentedCode(
  headers: Record<string, string | undefined> | undefined,
): string | undefined {
  return presented(headers);
}

/**
 * Header the browser app uses. MCP clients use `Authorization: Bearer`.
 *
 * Two headers because of CloudFront: whether it forwards `Authorization` depends on
 * cache-policy settings that are easy to get subtly wrong, while an ordinary custom
 * header is forwarded by the standard origin request policy with no special care.
 */
export const ACCESS_HEADER = 'x-still-there-access';

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

function presented(headers: Record<string, string | undefined> | undefined): string | undefined {
  if (headers === undefined) return undefined;

  const custom = header(headers, ACCESS_HEADER)?.trim();
  if (custom !== undefined && custom !== '') return custom;

  const value = header(headers, 'authorization');
  if (value === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim();
}

export type AccessResult = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

export async function checkAccess(
  headers: Record<string, string | undefined> | undefined,
): Promise<AccessResult> {
  const secretArn = process.env['ACCESS_CODE_SECRET_ARN'];
  if (secretArn === undefined || secretArn === '') {
    // Fail closed. A missing configuration value must not quietly open the door.
    return { allowed: false, reason: 'access control is not configured' };
  }

  const code = presented(headers);
  if (code === undefined || code === '') {
    return { allowed: false, reason: 'no access code presented' };
  }

  // Compare fixed-length digests so neither the code's length nor its content
  // leaks through timing.
  const ok = timingSafeEqual(digest(code), digest(await expectedCode(secretArn)));
  return ok ? { allowed: true } : { allowed: false, reason: 'access code not recognised' };
}

/** Test seam. */
export function resetAccessCache(): void {
  cached = undefined;
}
