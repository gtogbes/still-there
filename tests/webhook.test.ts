import { describe, expect, it } from 'vitest';
import {
  signNonce,
  signPayload,
  verifyNonce,
  verifyWebhookSignature,
} from '../src/ring/webhook.js';

const KEY = 'test-hmac-key-not-a-real-credential';
const BODY = '{"eventType":"motion","deviceId":"dev-1","occurredAt":"2026-09-10T07:35:00Z"}';

describe('webhook signature verification', () => {
  it('accepts a correctly signed body', () => {
    const signature = signPayload(BODY, KEY);
    expect(verifyWebhookSignature(BODY, signature, KEY).valid).toBe(true);
  });

  it('accepts an upper-case hex signature', () => {
    const signature = signPayload(BODY, KEY).toUpperCase();
    expect(verifyWebhookSignature(BODY, signature, KEY).valid).toBe(true);
  });

  it('rejects a body that has been altered', () => {
    // The attack that matters is not forging an alert, it is suppressing one:
    // rewriting a payload so the system believes it saw activity it did not.
    const signature = signPayload(BODY, KEY);
    const tampered = BODY.replace('dev-1', 'dev-2');
    expect(verifyWebhookSignature(tampered, signature, KEY).valid).toBe(false);
  });

  it('rejects a signature made with the wrong key', () => {
    const signature = signPayload(BODY, 'some-other-key');
    expect(verifyWebhookSignature(BODY, signature, KEY).valid).toBe(false);
  });

  it('rejects a missing signature', () => {
    const result = verifyWebhookSignature(BODY, undefined, KEY);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('no signature');
  });

  it('rejects when no key is configured rather than passing silently', () => {
    const result = verifyWebhookSignature(BODY, signPayload(BODY, KEY), '');
    expect(result.valid).toBe(false);
  });

  it('returns a failure rather than throwing on a truncated signature', () => {
    // timingSafeEqual throws on a length mismatch. If that escapes, a malformed
    // request becomes a 500 and Ring retries it forever.
    const short = signPayload(BODY, KEY).slice(0, 10);
    expect(() => verifyWebhookSignature(BODY, short, KEY)).not.toThrow();
    expect(verifyWebhookSignature(BODY, short, KEY).valid).toBe(false);
  });

  it('must be given the exact bytes received, not re-serialised JSON', () => {
    // The trap: parse the body, verify against JSON.stringify of the result. The
    // payload is semantically identical and the digest is completely different,
    // so every webhook fails and it looks like an attack rather than a plumbing
    // bug. Pinned as a test so nobody "tidies up" the handler into it.
    const asReceived = '{\n  "eventType": "motion",\n  "deviceId": "dev-1"\n}';
    const signature = signPayload(asReceived, KEY);
    const reserialised = JSON.stringify(JSON.parse(asReceived));

    expect(reserialised).not.toBe(asReceived);
    expect(verifyWebhookSignature(reserialised, signature, KEY).valid).toBe(false);
    expect(verifyWebhookSignature(asReceived, signature, KEY).valid).toBe(true);
  });

  it('rejects a trailing byte appended to the body', () => {
    const signature = signPayload(BODY, KEY);
    expect(verifyWebhookSignature(`${BODY} `, signature, KEY).valid).toBe(false);
  });

  it('never leaks the key or the signature in a failure reason', () => {
    const signature = signPayload(BODY, KEY);
    const result = verifyWebhookSignature('tampered', signature, KEY);
    expect(result.reason).toBeDefined();
    expect(result.reason).not.toContain(KEY);
    expect(result.reason).not.toContain(signature);
  });
});

describe('account-linking nonces', () => {
  it('round-trips a nonce', () => {
    const nonce = 'abc123';
    expect(verifyNonce(nonce, signNonce(nonce, KEY), KEY)).toBe(true);
  });

  it('produces URL-safe Base64, not hex', () => {
    // Same key as webhook verification, different encoding. Confusing the two is
    // an easy and silent mistake, so it is pinned here.
    const signed = signNonce('abc123', KEY);
    expect(signed).not.toMatch(/^[0-9a-f]+$/);
    expect(signed).not.toContain('+');
    expect(signed).not.toContain('/');
    expect(signed).not.toContain('=');
  });

  it('rejects a nonce signed with another key', () => {
    expect(verifyNonce('abc123', signNonce('abc123', 'other'), KEY)).toBe(false);
  });
});
