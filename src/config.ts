/**
 * Configuration and credential loading.
 *
 * Kept deliberately small and boring. The one rule that matters: secret values
 * never appear in a log line, an error message, or a thrown stack. Every failure
 * path below names the missing variable and stops, rather than reporting what it
 * found.
 */

export type RingEnvironment = 'sandbox' | 'production';

export interface RingConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly hmacKey: string;
  readonly apiBaseUrl: string;
  readonly oauthBaseUrl: string;
  readonly webhookUrl: string;
  readonly environment: RingEnvironment;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULTS = {
  apiBaseUrl: 'https://api.amazonvision.com',
  oauthBaseUrl: 'https://oauth.ring.com',
} as const;

function required(source: Record<string, string | undefined>, key: string): string {
  const value = source[key];
  if (value === undefined || value.trim() === '') {
    throw new ConfigError(`${key} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value.trim();
}

function optional(
  source: Record<string, string | undefined>,
  key: string,
  fallback: string,
): string {
  const value = source[key];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

export function loadRingConfig(source: Record<string, string | undefined>): RingConfig {
  const environment = optional(source, 'RING_ENVIRONMENT', 'sandbox');
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new ConfigError(
      `RING_ENVIRONMENT must be 'sandbox' or 'production', received '${environment}'.`,
    );
  }

  return {
    clientId: required(source, 'RING_CLIENT_ID'),
    clientSecret: required(source, 'RING_CLIENT_SECRET'),
    hmacKey: required(source, 'RING_HMAC_KEY'),
    apiBaseUrl: optional(source, 'RING_API_BASE_URL', DEFAULTS.apiBaseUrl),
    oauthBaseUrl: optional(source, 'RING_OAUTH_BASE_URL', DEFAULTS.oauthBaseUrl),
    webhookUrl: optional(source, 'RING_WEBHOOK_URL', ''),
    environment,
  };
}

/**
 * Safe to log. Confirms which credentials are present without revealing any of
 * them, which is what you actually want at startup — "is it configured" rather
 * than "what is it".
 */
export function describeConfig(config: RingConfig): Record<string, string> {
  const present = (value: string): string => (value === '' ? 'missing' : `set (${value.length} chars)`);
  return {
    environment: config.environment,
    apiBaseUrl: config.apiBaseUrl,
    oauthBaseUrl: config.oauthBaseUrl,
    webhookUrl: config.webhookUrl === '' ? 'missing' : config.webhookUrl,
    clientId: present(config.clientId),
    clientSecret: present(config.clientSecret),
    hmacKey: present(config.hmacKey),
  };
}
