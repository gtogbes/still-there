import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Assessment } from '../domain/types.js';
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

export interface AssessmentContext {
  readonly anchorCount: number;
  readonly historyDays: number;
  readonly eventsToday: number;
}

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

export async function recentAssessments(
  tables: TableNames,
  householdId: string,
  limit = 20,
): Promise<Assessment[]> {
  const result = await documentClient().send(
    new QueryCommand({
      TableName: tables.events,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `assessment#${householdId}` },
      ScanIndexForward: false, // Newest first.
      Limit: limit,
    }),
  );
  return (result.Items ?? []) as unknown as Assessment[];
}
