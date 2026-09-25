import { describe, expect, it } from 'vitest';
import { ConfigError, describeConfig, loadRingConfig } from '../src/config.js';

const complete = {
  RING_CLIENT_ID: 'client-id-value',
  RING_CLIENT_SECRET: 'client-secret-value',
  RING_HMAC_KEY: 'hmac-key-value',
};

describe('configuration loading', () => {
  it('loads the three credentials and applies defaults', () => {
    const config = loadRingConfig(complete);
    expect(config.clientId).toBe('client-id-value');
    expect(config.apiBaseUrl).toBe('https://api.amazonvision.com');
    expect(config.oauthBaseUrl).toBe('https://oauth.ring.com');
  });

  it('names the variable that is missing', () => {
    expect(() => loadRingConfig({ ...complete, RING_HMAC_KEY: undefined })).toThrow(ConfigError);
    expect(() => loadRingConfig({ ...complete, RING_HMAC_KEY: undefined })).toThrow(
      /RING_HMAC_KEY/,
    );
  });

  it('treats whitespace-only values as missing', () => {
    // Copy-paste from a portal leaves stray whitespace surprisingly often, and a
    // key of " " fails signature verification in a way that looks like an attack.
    expect(() => loadRingConfig({ ...complete, RING_CLIENT_SECRET: '   ' })).toThrow(ConfigError);
  });

  it('trims values', () => {
    const config = loadRingConfig({ ...complete, RING_CLIENT_ID: '  padded  ' });
    expect(config.clientId).toBe('padded');
  });

  it('strips surrounding quotes', () => {
    // Not hypothetical. The real credentials arrived as `KEY= "value"`, and a
    // quoted HMAC key fails every signature check while looking exactly like
    // somebody forging requests.
    const config = loadRingConfig({
      RING_CLIENT_ID: ' "quoted-id"',
      RING_CLIENT_SECRET: "'single-quoted'",
      RING_HMAC_KEY: '  "padded-and-quoted"  ',
    });
    expect(config.clientId).toBe('quoted-id');
    expect(config.clientSecret).toBe('single-quoted');
    expect(config.hmacKey).toBe('padded-and-quoted');
  });

  it('leaves an unmatched quote alone', () => {
    // Only a matched pair is removed. A stray leading quote is more likely a
    // truncated paste, and silently repairing it would hide the damage.
    const config = loadRingConfig({ ...complete, RING_CLIENT_ID: '"unbalanced' });
    expect(config.clientId).toBe('"unbalanced');
  });

  it('treats a quoted empty string as missing', () => {
    expect(() => loadRingConfig({ ...complete, RING_HMAC_KEY: '""' })).toThrow(ConfigError);
  });

});

describe('describing configuration for logs', () => {
  it('confirms credentials are present without revealing them', () => {
    const config = loadRingConfig(complete);
    const described = JSON.stringify(describeConfig(config));
    expect(described).not.toContain('client-secret-value');
    expect(described).not.toContain('hmac-key-value');
    expect(described).not.toContain('client-id-value');
    expect(described).toContain('set (');
  });
});
