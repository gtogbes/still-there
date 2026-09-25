import { adaptActivityEvent, adaptDeviceHealth, adaptRevocation } from './adapter.js';
import type { AdaptedActivity, AdaptedHealth, AdaptedRevocation } from './adapter.js';
import type { DeviceRegistry } from './devices.js';

/**
 * Decides what an inbound Ring payload is.
 *
 * Extracted from the webhook handler because the orchestration had a bug that no
 * test could catch while it was tangled up with DynamoDB and Secrets Manager.
 *
 * The bug: both adapters were run and the payload was only called uninterpretable
 * when *both* returned 'invalid'. But the health adapter answers 'ignored' for
 * anything that is not a status event, so it masked the activity adapter's
 * 'invalid' and genuinely unknown event types were silently swallowed as
 * "ignored" — the precise silence the strict adapter exists to prevent. It took a
 * live deployment to notice. Now it is a pure function with a regression test.
 */

export type Classification =
  | { readonly kind: 'activity'; readonly activity: AdaptedActivity }
  | { readonly kind: 'health'; readonly health: AdaptedHealth }
  /** The user withdrew consent. Everything we hold about them must be erased. */
  | { readonly kind: 'revocation'; readonly revocation: AdaptedRevocation }
  /** Understood and deliberately not acted on. */
  | { readonly kind: 'ignored'; readonly reason: string }
  /** Nobody can read this. Worth alerting on: it means a payload shape moved. */
  | { readonly kind: 'uninterpretable'; readonly reason: string };

export function classifyRingPayload(
  payload: unknown,
  registry: DeviceRegistry,
): Classification {
  const activity = adaptActivityEvent(payload, registry);

  // The activity adapter's verdict is authoritative, because it already returns
  // 'ignored' rather than 'invalid' for device status types. So 'invalid' here
  // genuinely means unreadable, and must not be second-guessed by asking the
  // health adapter what it thinks.
  if (activity.outcome === 'invalid') {
    return { kind: 'uninterpretable', reason: activity.reason };
  }

  if (activity.outcome === 'ok') {
    return { kind: 'activity', activity: activity.value };
  }

  // Checked before health, and before the generic ignore, because a withdrawal of
  // consent is the one message here that obliges us to act rather than record.
  const revocation = adaptRevocation(payload);
  if (revocation.outcome === 'ok') {
    return { kind: 'revocation', revocation: revocation.value };
  }
  if (revocation.outcome === 'invalid') {
    return { kind: 'uninterpretable', reason: revocation.reason };
  }

  const health = adaptDeviceHealth(payload, registry);
  if (health.outcome === 'ok') {
    return { kind: 'health', health: health.value };
  }
  if (health.outcome === 'invalid') {
    return { kind: 'uninterpretable', reason: health.reason };
  }

  return { kind: 'ignored', reason: activity.reason };
}
