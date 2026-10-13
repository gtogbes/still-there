import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Assessment, Severity } from '../domain/types.js';
import { documentClient, eventSortKey, type TableNames } from './tables.js';

/**
 * Assessment history.
 *
 * Kept for two reasons beyond debugging. It is the audit trail for why a family was
 * contacted — each finding carries the habit, the expected time and how consistent
 * that habit had been — and it is the only way to measure the false-positive rate
 * against a real household rather than against synthetic personas.
 *
 * Stored on the events table under a distinct partition, so a household's activity
 * query never picks them up.
 */

/** What was actually sent, recorded with the assessment that produced it. */
export interface SentNotification {
  readonly text: string;
  /** 'model' when Bedrock phrased it, 'fallback' for the deterministic wording. */
  readonly source: string;
  readonly severity: Severity;
  readonly delivered: boolean;
}

export interface AssessmentContext {
  readonly anchorCount: number;
  readonly historyDays: number;
  readonly eventsToday: number;
  /**
   * Present only on assessments that contacted the family. Storing the exact text
   * means "why did you message me" can be answered with what the person actually
   * read, rather than a reconstruction of it.
   */
  readonly notification?: SentNotification;
}

export type StoredAssessment = Assessment & AssessmentContext;

const RETENTION_DAYS = 180;

export async function putAssessment(
  tables: TableNames,
  assessment: Assessment,
  context: AssessmentContext,
): Promise<void> {
  await documentClient().send(
    new PutCommand({
      TableName: tables.events,
      Item: {
        pk: `assessment#${assessment.householdId}`,
        sk: eventSortKey(assessment.evaluatedAt, 'assessment'),
        ...assessment,
        ...context,
        // Deliberately longer than event retention. The events behind a decision
        // expire after ninety days; the record of the decision itself outlives them,
        // because "why did you call me that Tuesday" is a question worth answering.
        expiresAt: Math.floor(assessment.evaluatedAt / 1000) + RETENTION_DAYS * 86_400,
      },
    }),
  );
}

/**
 * Assessments within a window, newest first.
 *
 * Paginated rather than limited. A day holds up to 96 assessments, and a `Limit`
 * combined with a filter silently returns fewer matches than exist — the kind of bug
 * that makes "why did you message me" answer "I didn't" on the one day it did.
 */
export async function assessmentsBetween(
  tables: TableNames,
  householdId: string,
  fromInclusive: number,
  toInclusive: number,
): Promise<StoredAssessment[]> {
  const collected: StoredAssessment[] = [];
  let startKey: Record<string, unknown> | undefined;

  do {
    const page = await documentClient().send(
      new QueryCommand({
        TableName: tables.events,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': `assessment#${householdId}`,
          ':from': eventSortKey(fromInclusive, ''),
          ':to': eventSortKey(toInclusive, '\uffff'),
        },
        ScanIndexForward: false,
        ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey }),
      }),
    );
    collected.push(...((page.Items ?? []) as unknown as StoredAssessment[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey !== undefined);

  return collected;
}

/** The most recent assessment that contacted the family, at or before `at`. */
export async function lastNotificationBefore(
  tables: TableNames,
  householdId: string,
  at: number,
  lookbackDays = 7,
): Promise<StoredAssessment | undefined> {
  const window = await assessmentsBetween(
    tables,
    householdId,
    at - lookbackDays * 86_400_000,
    at,
  );
  return window.find((a) => a.notification !== undefined);
}

export async function recentAssessments(
  tables: TableNames,
  householdId: string,
  limit = 20,
): Promise<StoredAssessment[]> {
  const result = await documentClient().send(
    new QueryCommand({
      TableName: tables.events,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `assessment#${householdId}` },
      ScanIndexForward: false, // Newest first.
      Limit: limit,
    }),
  );
  return (result.Items ?? []) as unknown as StoredAssessment[];
}
