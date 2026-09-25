import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { Severity } from '../domain/types.js';

/**
 * Sends the notification.
 *
 * SNS email for now, which is honest about what this build is: enough to prove the
 * message reaches a person, not the product's real delivery channel. A shipped
 * version would want push, since an email at 11am on a Tuesday is a poor way to
 * reach somebody who needs to decide whether to phone their mother.
 *
 * Failures here are logged and swallowed rather than thrown. An assessment that
 * succeeded and then failed to deliver should still record what it found — losing the
 * finding as well as the notification would remove the only evidence that anything
 * was noticed.
 */

let client: SNSClient | undefined;

export interface NotifyResult {
  readonly delivered: boolean;
  readonly reason?: string;
}

/**
 * Subject lines carry no detail.
 *
 * An email subject shows up on a lock screen, in a notification centre, and over
 * somebody's shoulder on a train. The specifics stay in the body.
 */
function subjectFor(severity: Severity): string {
  switch (severity) {
    case 'high':
      return 'StillThere — worth a call today';
    case 'medium':
      return 'StillThere — something looks different today';
    case 'low':
      return 'StillThere — a small change today';
  }
}

export async function publishNotification(
  topicArn: string,
  severity: Severity,
  message: string,
): Promise<NotifyResult> {
  if (topicArn === '' || message === '') {
    return { delivered: false, reason: 'no topic configured or nothing to say' };
  }

  try {
    client ??= new SNSClient({});
    await client.send(
      new PublishCommand({
        TopicArn: topicArn,
        Subject: subjectFor(severity),
        Message: message,
      }),
    );
    return { delivered: true };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'UnknownError';
    return { delivered: false, reason: name };
  }
}
