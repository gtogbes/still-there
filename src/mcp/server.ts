import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { APP_HTML } from './app-html.generated.js';
import { eventsBetween } from '../storage/events.js';
import { getHousehold, putHousehold, type StoredHousehold } from '../storage/household.js';
import { assessmentsBetween, lastNotificationBefore } from '../storage/assessments.js';
import { deviceHealthFor } from '../storage/state.js';
import type { TableNames } from '../storage/tables.js';
import type { ActivityEvent } from '../domain/types.js';
import {
  baselineWindow,
  buildSuppression,
  describeRoutine,
  describeSuppression,
  endSuppressions,
  explainAssessment,
  householdStatus,
  sentMessages,
  type ToolAnswer,
} from './tools.js';

/**
 * StillThere as an MCP server.
 *
 * Five tools, written to be asked rather than read. Every result carries both a
 * sentence (for speech) and structuredContent (for a screen), so the same server
 * serves a voice-only assistant and a display device without either compromising.
 *
 * The interesting one is `explain_last_alert`. A monitoring product usually cannot
 * tell you why it contacted you, because the reasoning existed only as long as the
 * alert took to send. Here the exact message and the findings behind it are stored,
 * so the explanation is recalled rather than reconstructed.
 *
 * No tool returns raw events, device identifiers or images.
 */

export interface ServerDeps {
  readonly tables: TableNames;
  readonly householdId: string;
  /**
   * The current instant, given the household's time zone.
   *
   * A function of the zone because the demo clock sets a local time of day — "show
   * me 09:30" — and that can only become an instant once we know where the house is.
   */
  readonly now: (timeZone: string) => number;
}

/**
 * The learning window, cached per warm container.
 *
 * Six weeks of history ending at midnight cannot change during the day, yet every
 * status question used to re-read all of it — most of the server's time per call,
 * against a 500 ms round-trip budget for Alexa+. Keyed by the window itself, so a
 * new day is a new key, and held for ten minutes so a late-arriving event for an
 * earlier day is picked up soon after.
 */
const HISTORY_TTL_MS = 10 * 60_000;
const historyCache = new Map<string, { readonly at: number; readonly events: Promise<ActivityEvent[]> }>();

function cachedHistory(tables: TableNames, householdId: string, from: number, until: number): Promise<ActivityEvent[]> {
  const key = `${tables.events}|${householdId}|${from}|${until}`;
  const hit = historyCache.get(key);
  if (hit !== undefined && Date.now() - hit.at < HISTORY_TTL_MS) return hit.events;

  const events = eventsBetween(tables, householdId, from, until);
  // A failed read must not be cached, or one throttled query poisons ten minutes.
  events.catch(() => historyCache.delete(key));
  historyCache.clear(); // Only the current window is ever worth keeping.
  historyCache.set(key, { at: Date.now(), events });
  return events;
}

/** Test seam. */
export function clearHistoryCache(): void {
  historyCache.clear();
}

/**
 * The MCP App view: one self-contained HTML document, served as a `ui://` resource.
 *
 * Every tool points at it, so a host that supports MCP Apps — Alexa+ on an Echo Show
 * among them — draws the answer instead of only reading it out. Hosts without the
 * extension ignore `_meta` and use the text, which is why every tool still returns
 * a complete spoken sentence.
 *
 * The view makes no network requests of its own, so its CSP declares no domains.
 */
export const VIEW_URI = 'ui://still-there/today.html';
const VIEW = { ui: { resourceUri: VIEW_URI } };
const VIEW_META = { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: false } };

const NO_HOUSEHOLD = {
  content: [{ type: 'text' as const, text: 'No household is set up yet, so there is nothing to check.' }],
};

function result<T extends object>(answer: ToolAnswer<T>) {
  return {
    content: [{ type: 'text' as const, text: answer.text }],
    structuredContent: answer.data as Record<string, unknown>,
  };
}

export function buildMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: 'still-there', version: '0.2.0' },
    {
      instructions: [
        'StillThere watches for the daily activity that did NOT happen in an older',
        "person's home, and tells family when a usual habit is overdue.",
        '',
        'still_there_status — "is she up yet", "is everything alright", "any news"',
        'explain_last_alert — "why did you message me", "what was that about"',
        'describe_routine   — "what does a normal day look like for her"',
        'pause_monitoring   — "she is away this week" (ask how many days if unclear)',
        'resume_monitoring  — "she is back", "start watching again"',
        '',
        'Never speculate about why activity is missing, and never suggest medical',
        'causes. Report what is overdue and by how much.',
      ].join('\n'),
    },
  );

  registerAppResource(
    server,
    "StillThere: today's view",
    VIEW_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Draws a StillThere answer: today's habits on a timeline, the learned routine, or why a message was sent.",
      _meta: VIEW_META,
    },
    async () => ({
      contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: APP_HTML, _meta: VIEW_META }],
    }),
  );

  const load = async (): Promise<StoredHousehold | undefined> =>
    getHousehold(deps.tables, deps.householdId);

  registerAppTool(
    server,
    'still_there_status',
    {
      _meta: VIEW,
      title: 'Check on the household',
      description:
        'Whether the resident appears to be having a normal day, or whether a usual activity is overdue. Use for "is Mum up yet", "is everything alright", "any news".',
      inputSchema: {},
    },
    async () => {
      const household = await load();
      if (household === undefined) return NO_HOUSEHOLD;

      const evaluatedAt = deps.now(household.timeZone);
      const window = baselineWindow(evaluatedAt, household.timeZone);
      const [historyEvents, todaysEvents, health] = await Promise.all([
        cachedHistory(deps.tables, deps.householdId, window.learnFrom, window.dayStart),
        eventsBetween(deps.tables, deps.householdId, window.dayStart, window.dayEnd),
        deviceHealthFor(deps.tables, deps.householdId),
      ]);

      return result(
        householdStatus({ household, historyEvents, todaysEvents, health, evaluatedAt }),
      );
    },
  );

  registerAppTool(
    server,
    'explain_last_alert',
    {
      _meta: VIEW,
      title: 'Explain the last alert',
      description:
        'Why StillThere last got in touch: the exact message sent, which habits were missed, when they were expected, and how consistent they had been. Use for "why did you message me", "what was that about".',
      inputSchema: {},
    },
    async () => {
      const household = await load();
      if (household === undefined) return NO_HOUSEHOLD;

      const now = deps.now(household.timeZone);
      const { dayStart } = baselineWindow(now, household.timeZone);
      const [last, today] = await Promise.all([
        lastNotificationBefore(deps.tables, deps.householdId, now),
        assessmentsBetween(deps.tables, deps.householdId, dayStart, now),
      ]);
      return result(
        explainAssessment(last, household.timeZone, sentMessages(today, household.timeZone)),
      );
    },
  );

  registerAppTool(
    server,
    'describe_routine',
    {
      _meta: VIEW,
      title: "Describe the resident's learned routine",
      description:
        'The daily pattern StillThere has learned, and how dependable each habit is. Use for "what does a normal day look like", "what do you actually watch for".',
      inputSchema: {},
    },
    async () => {
      const household = await load();
      if (household === undefined) return NO_HOUSEHOLD;

      const window = baselineWindow(deps.now(household.timeZone), household.timeZone);
      const historyEvents = await cachedHistory(
        deps.tables,
        deps.householdId,
        window.learnFrom,
        window.dayStart,
      );
      return result(describeRoutine(household, historyEvents));
    },
  );

  registerAppTool(
    server,
    'pause_monitoring',
    {
      _meta: VIEW,
      title: 'Pause monitoring while the resident is away',
      description:
        'Stop raising alerts for a number of days, for a holiday or a stay elsewhere. Activity is still recorded so the learned routine is not lost. Use for "Mum is away this week", "stop watching until Friday".',
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
          .describe('Why, in a few words — "visiting family", "on holiday".'),
      },
    },
    async ({ days, reason }) => {
      const household = await load();
      if (household === undefined) return NO_HOUSEHOLD;

      const now = deps.now(household.timeZone);
      const window = buildSuppression(now, days, reason ?? 'away');
      // Expired windows are dropped rather than accumulated: they have no effect,
      // and a list that only ever grows is a slow leak.
      const retained = household.suppressions.filter((w) => w.to > now);

      await putHousehold(deps.tables, {
        ...household,
        suppressions: [...retained, window],
        updatedAt: Date.now(),
      });

      return result(describeSuppression(window, household.timeZone));
    },
  );

  registerAppTool(
    server,
    'resume_monitoring',
    {
      _meta: VIEW,
      title: 'Resume monitoring',
      description:
        'End a pause early because the resident is home again. Use for "she is back", "start watching again".',
      inputSchema: {},
    },
    async () => {
      const household = await load();
      if (household === undefined) return NO_HOUSEHOLD;

      const { remaining, answer } = endSuppressions(
        household.suppressions,
        deps.now(household.timeZone),
      );
      await putHousehold(deps.tables, {
        ...household,
        suppressions: remaining,
        updatedAt: Date.now(),
      });
      return result(answer);
    },
  );

  return server;
}
