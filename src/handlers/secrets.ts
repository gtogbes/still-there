import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

/**
 * Ring credentials, fetched from Secrets Manager rather than passed as Lambda
 * environment variables.
 *
 * Environment variables are visible to anyone with read access to the function's
 * configuration and get echoed into a surprising number of places — console
 * screenshots, CloudFormation drift output, `aws lambda get-function` in somebody's
 * shell history. Only the secret's ARN travels in the environment.
 *
 * Cached for the life of the execution environment. A cold start pays one API call;
 * everything after that is free.
 */

export interface RingSecrets {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly hmacKey: string;
}

let cached: RingSecrets | undefined;
let client: SecretsManagerClient | undefined;

function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`secret is missing '${key}'`);
  }
  // Same quote-stripping as the local loader. The value was pasted by a human at
  // some point, and a quoted HMAC key fails every signature check while looking
  // exactly like a forged request.
  const trimmed = value.trim();
  const unquoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  if (unquoted === '') throw new Error(`secret '${key}' is empty after unquoting`);
  return unquoted;
}

export async function ringSecrets(secretArn: string): Promise<RingSecrets> {
  if (cached !== undefined) return cached;

  client ??= new SecretsManagerClient({});
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (response.SecretString === undefined) {
    throw new Error('secret has no string value');
  }

  const parsed: unknown = JSON.parse(response.SecretString);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('secret is not a JSON object');
  }
  const source = parsed as Record<string, unknown>;

  cached = {
    clientId: stringField(source, 'clientId'),
    clientSecret: stringField(source, 'clientSecret'),
    hmacKey: stringField(source, 'hmacKey'),
  };
  return cached;
}

/** Test seam. Clears the cache between cases. */
export function resetSecretsCache(): void {
  cached = undefined;
}
