import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { eventsBetween } from '../storage/events.js';
import { getHousehold, putHousehold } from '../storage/household.js';
import { recentAssessments } from '../storage/assessments.js';
import { deviceHealthFor } from '../storage/state.js';
import type { TableNames } from '../storage/tables.js';
import {
  baselineWindow,
  buildSuppression,
  describeRoutine,
  describeSuppression,
  explainAssessment,
  householdStatus,
} from './tools.js';

/**
 * StillThere as an MCP server.
 *
 * Four tools, written to be *asked* rather than read. The interesting one is
 * `explain_last_alert`: a monitoring product usually cannot tell you why it contacted
 * you, because the reasoning existed only for as long as the alert took to send. Here
 * every assessment is stored with the habit, the time expected and how dependable
 * that habit had been, so the explanation is recalled rather than reconstructed.
 *
 * `pause_monitoring` is the only tool that writes, and it earns its place: without it
 * the system cries wolf for the whole of a fortnight's holiday, which is the fastest
 * way to get a monitoring product muted for good.
 *
 * Deliberately no tool returns raw events, device identifiers or images. The questions
 * are about a person, and the answers are sentences.
 */

export interface ServerDeps {
  readonly tables: TableNames;
  readonly householdId: string;
  /** Injected so tests can fix the instant, consistent with the rest of the codebase. */
  readonly now: () => number;
}

export function buildMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: 'still-there', version: '0.1.0' },
    {
      instructions: [
        'StillThere watches for the daily activity that did NOT happen in an older',
        "person's home, using their existing Ring devices, and tells family when a",
        'usual habit is overdue.',
        '',
        'Use still_there_status for "is she up yet" or "is everything alright".',
        'Use explain_last_alert when asked why a message was sent.',
        'Use describe_routine for "what does a normal day look like for her".',
        'Use pause_monitoring when told the resident is away.',
        '',
        'Never speculate about why activity is missing. Report what is overdue and by',
        'how much. Do not suggest medical causes.',
      ].join('\n'),
    },
  );

  server.registerTool(
    'still_there_status',
    {
      title: 'Check on the household',
      description:
        'Whether the resident appears to be having a normal day, or whether a usual activity is overdue. Use for "is Mum up yet", "is everything alright", "any news".',
      inputSchema: {},
    },
    async () => {
      const household = await getHousehold(deps.tables, deps.householdId);
      if (household === undefined) {
        return {
          content: [{ type: 'text', text: 'No household is set up yet, so there is nothing to check.' }],
        };
      }

      const evaluatedAt = deps.now();
      const window = baselineWindow(evaluatedAt, household.timeZone);
      const [historyEvents, todaysEvents, health] = await Promise.all([
        eventsBetween(deps.tables, deps.householdId, window.learnFrom, window.dayStart),
        eventsBetween(deps.tables, deps.householdId, window.dayStart, window.dayEnd),
        deviceHealthFor(deps.tables, deps.householdId),
      ]);

      const { text } = householdStatus({
        household,
        historyEvents,
        todaysEvents,
        health,
        evaluatedAt,
      });

      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'explain_last_alert',
    {
      title: 'Explain the last alert',
      description:
        'Why StillThere last got in touch: which habits were missed, when they were expected, and how consistent they had been. Use for "why did you message me", "what was that about".',
      inputSchema: {},
    },
    async () => {
      const household = await getHousehold(deps.tables, deps.householdId);
      if (household === undefined) {
        return { content: [{ type: 'text', text: 'No household is set up yet.' }] };
      }

      const recent = await recentAssessments(deps.tables, deps.householdId, 25);
      // The most recent assessment that actually found something. Walking back past
      // the quiet ones matters: the last run is almost always "nothing to report",
      // and answering with that would be useless to somebody holding a phone asking
      // why it buzzed an hour ago.
      const lastAlerting = recent.find((a) =>
        a.findings.some((f) => f.type === 'deviation'),
      );

      return {
        content: [{ type: 'text', text: explainAssessment(lastAlerting, household.timeZone) }],
      };
    },
  );

  server.registerTool(
    'describe_routine',
    {
      title: "Describe the resident's learned routine",
      description:
        'The daily pattern StillThere has learned, and how dependable each habit is. Use for "what does a normal day look like", "what do you actually watch for".',
      inputSchema: {},
    },
    async () => {
      const household = await getHousehold(deps.tables, deps.householdId);
      if (household === undefined) {
        return { content: [{ type: 'text', text: 'No household is set up yet.' }] };
      }

      const window = baselineWindow(deps.now(), household.timeZone);
      const historyEvents = await eventsBetween(
        deps.tables,
        deps.householdId,
        window.learnFrom,
        window.dayEnd,
      );

      return { content: [{ type: 'text', text: describeRoutine(household, historyEvents) }] };
    },
  );

  server.registerTool(
    'pause_monitoring',
    {
      title: 'Pause monitoring while the resident is away',
      description:
        'Stop raising alerts for a number of days, for a holiday or a hospital stay. Activity is still recorded so the learned routine is not lost. Use for "Mum is away this week", "stop watching until Friday".',
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .describe('How many days to pause for. Ask the user if unclear rather than guessing.'),
        reason: z
          .string()
          .max(120)
          .optional()
          .describe('Why, in a few words — "away visiting family", "in hospital".'),
      },
    },
    async ({ days, reason }) => {
      const household = await getHousehold(deps.tables, deps.householdId);
      if (household === undefined) {
        return { content: [{ type: 'text', text: 'No household is set up yet.' }] };
      }

      const now = deps.now();
      const window = buildSuppression(now, days, reason ?? 'away');

      // Existing expired windows are dropped rather than accumulated. They have no
      // effect, and a suppression list that only ever grows is a slow leak.
      const retained = household.suppressions.filter((w) => w.to > now);

      await putHousehold(deps.tables, {
        ...household,
        suppressions: [...retained, window],
        updatedAt: now,
      });

      return {
        content: [{ type: 'text', text: describeSuppression(window, household.timeZone) }],
      };
    },
  );

  return server;
}
