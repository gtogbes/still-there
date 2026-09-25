/**
 * Configuration and credential loading.
 *
 * Kept deliberately small and boring. The one rule that matters: secret values
 * never appear in a log line, an error message, or a thrown stack. Every failure
 * path below names the missing variable and stops, rather than reporting what it
 * found.
 */

/**
 * Note on what is deliberately absent.
 *
 * There was a `RING_ENVIRONMENT` setting here, offering a choice between 'sandbox'
 * and 'production'. It has been removed because it was a lie: Ring publishes one
 * API base — `api.amazonvision.com` — and there is no separate sandbox endpoint to
 * point at. The deployed handlers never read it either. A configuration knob that
 * looks meaningful and changes nothing is worse than no knob at all, because
 * somebody eventually trusts it.
 */
export interface RingConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly hmacKey: string;
  readonly apiBaseUrl: string;
  readonly oauthBaseUrl: string;
  readonly webhookUrl: string;
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

/**
 * Trims, then removes a matched pair of surrounding quotes.
 *
 * Learned the hard way. A credential pasted from the Ring portal arrived as
 * `KEY= "abc..."`, and a quoted HMAC key fails every signature check while
 * looking precisely like someone forging requests. None of these credential
 * formats legitimately begin and end with a quote, so stripping is unambiguous
 * and far kinder than the alternative.
 */
function clean(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function required(source: Record<string, string | undefined>, key: string): string {
  const value = source[key];
  const cleaned = value === undefined ? '' : clean(value);
  if (cleaned === '') {
    throw new ConfigError(`${key} is not set. Copy .env.example to .env and fill it in.`);
  }
  return cleaned;
}

function optional(
  source: Record<string, string | undefined>,
  key: string,
  fallback: string,
): string {
  const value = source[key];
  const cleaned = value === undefined ? '' : clean(value);
  return cleaned === '' ? fallback : cleaned;
}

export function loadRingConfig(source: Record<string, string | undefined>): RingConfig {
  return {
    clientId: required(source, 'RING_CLIENT_ID'),
    clientSecret: required(source, 'RING_CLIENT_SECRET'),
    hmacKey: required(source, 'RING_HMAC_KEY'),
    apiBaseUrl: optional(source, 'RING_API_BASE_URL', DEFAULTS.apiBaseUrl),
    oauthBaseUrl: optional(source, 'RING_OAUTH_BASE_URL', DEFAULTS.oauthBaseUrl),
    webhookUrl: optional(source, 'RING_WEBHOOK_URL', ''),
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
    apiBaseUrl: config.apiBaseUrl,
    oauthBaseUrl: config.oauthBaseUrl,
    webhookUrl: config.webhookUrl === '' ? 'missing' : config.webhookUrl,
    clientId: present(config.clientId),
    clientSecret: present(config.clientSecret),
    hmacKey: present(config.hmacKey),
  };
}
