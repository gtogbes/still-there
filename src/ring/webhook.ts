import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signature verification.
 *
 * Ring signs webhook bodies with HMAC-SHA256, hex encoded, using the HMAC
 * Signature Key issued alongside the client credentials.
 *
 * This endpoint is the one part of the system exposed to the open internet, and
 * it accepts claims about whether an elderly person is moving around their home.
 * An unauthenticated version could be fed silence by anyone who found the URL,
 * which would suppress every alert the product exists to send. Verification is
 * therefore not optional and there is no bypass flag, not even for local
 * development — tests supply a known key instead.
 */

export interface VerificationResult {
  readonly valid: boolean;
  /** Present when invalid. Safe to log: never contains the key or the signature. */
  readonly reason?: string;
}

export function signPayload(rawBody: string, hmacKey: string): string {
  return createHmac('sha256', hmacKey).update(rawBody, 'utf8').digest('hex');
}

/**
 * Verifies a signature against the raw request body.
 *
 * Must be given the exact bytes received. Parsing JSON and re-serialising it
 * changes key order and whitespace, which changes the digest, and produces a
 * verification failure that looks like an attack and is actually a plumbing bug.
 */
export function verifyWebhookSignature(
  rawBody: string,
  providedSignature: string | undefined,
  hmacKey: string,
): VerificationResult {
  if (hmacKey === '') {
    return { valid: false, reason: 'no HMAC key configured' };
  }
  if (providedSignature === undefined || providedSignature === '') {
    return { valid: false, reason: 'no signature header present' };
  }

  const expected = signPayload(rawBody, hmacKey);

  // Compare as bytes, and length-check first: timingSafeEqual throws on a length
  // mismatch rather than returning false, and a thrown error here would read as
  // a server fault instead of a rejected request.
  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(providedSignature.trim().toLowerCase(), 'utf8');
  if (expectedBytes.length !== providedBytes.length) {
    return { valid: false, reason: 'signature length mismatch' };
  }
  if (!timingSafeEqual(expectedBytes, providedBytes)) {
    return { valid: false, reason: 'signature does not match' };
  }
  return { valid: true };
}

/**
 * Signs an account-linking nonce.
 *
 * Same key, different encoding — URL-safe Base64 rather than hex, because this
 * value travels in a query string. Easy to get wrong precisely because the key is
 * shared with webhook verification, so the two are kept side by side here.
 */
export function signNonce(nonce: string, hmacKey: string): string {
  return createHmac('sha256', hmacKey)
    .update(nonce, 'utf8')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function verifyNonce(nonce: string, providedSignature: string, hmacKey: string): boolean {
  const expected = Buffer.from(signNonce(nonce, hmacKey), 'utf8');
  const provided = Buffer.from(providedSignature, 'utf8');
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
