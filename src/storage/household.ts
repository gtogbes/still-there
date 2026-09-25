import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_OCCUPANCY_SUBJECTS } from '../domain/occupancy.js';
import type { HouseholdConfig, MotionSubject, SuppressionWindow } from '../domain/types.js';
import { documentClient, type TableNames } from './tables.js';

/**
 * Household configuration, stored rather than compiled in.
 *
 * Every value here is a judgement about a particular person's life — when their
 * night begins, which rooms are indoors, whether there is a pet. None of that
 * belongs in a deployment artefact, and getting it wrong is silent: label an
 * outdoor camera as interior and passing traffic becomes proof of life.
 */

export interface StoredHousehold extends HouseholdConfig {
  readonly suppressions: readonly SuppressionWindow[];
  readonly updatedAt: number;
  /**
   * What the resident is called, if the family chose to tell us.
   *
   * Optional on purpose. "No activity in the kitchen yet today" works without a
   * name, and storing one is a choice the household makes rather than a field we
   * insist on filling.
   */
  readonly residentName?: string;
}

export async function putHousehold(
  tables: TableNames,
  household: StoredHousehold,
): Promise<void> {
  await documentClient().send(
    new PutCommand({
      TableName: tables.state,
      Item: { pk: `household#${household.householdId}`, sk: 'config', ...household },
    }),
  );
}

export async function getHousehold(
  tables: TableNames,
  householdId: string,
): Promise<StoredHousehold | undefined> {
  const result = await documentClient().send(
    new GetCommand({
      TableName: tables.state,
      Key: { pk: `household#${householdId}`, sk: 'config' },
    }),
  );
  if (result.Item === undefined) return undefined;
  const row = result.Item as Record<string, unknown>;

  const interiorZones = Array.isArray(row['interiorZones'])
    ? (row['interiorZones'] as string[])
    : [];
  const occupancySubjects = Array.isArray(row['occupancySubjects'])
    ? (row['occupancySubjects'] as MotionSubject[])
    : DEFAULT_OCCUPANCY_SUBJECTS;

  return {
    householdId,
    timeZone: typeof row['timeZone'] === 'string' ? row['timeZone'] : 'Europe/London',
    interiorZones,
    // Falling back to the conservative default rather than an empty list. An empty
    // list would accept no motion at all as occupancy, which alerts constantly; a
    // permissive fallback would accept pets. Neither is a safe thing to land on by
    // accident, so the default is explicit.
    occupancySubjects:
      occupancySubjects.length === 0 ? DEFAULT_OCCUPANCY_SUBJECTS : occupancySubjects,
    quietFromMinute: typeof row['quietFromMinute'] === 'number' ? row['quietFromMinute'] : 23 * 60,
    quietToMinute: typeof row['quietToMinute'] === 'number' ? row['quietToMinute'] : 6 * 60,
    suppressions: Array.isArray(row['suppressions'])
      ? (row['suppressions'] as SuppressionWindow[])
      : [],
    updatedAt: typeof row['updatedAt'] === 'number' ? row['updatedAt'] : 0,
  };
}
