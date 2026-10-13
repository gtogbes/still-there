import { routeWithBedrock, type Turn } from '../assistant/bedrock-router.js';
import { openMcpSession, type McpSession } from '../assistant/mcp-client.js';
import { routeByKeywords, type Route } from '../assistant/router.js';
import { checkAccess, presentedCode } from './access.js';

/**
 * The simulated Alexa+ assistant.
 *
 *   utterance ──▶ Bedrock (tool use) ──▶ chosen MCP tool
 *                                           │  over HTTP, to /mcp, with the access code
 *                                           ▼
 *                    { speech, card, trace } ◀── the tool's sentence + structuredContent
 *
 * The spoken reply is the tool's own deterministic sentence, not model text, so the
 * model can misroute a question but cannot invent a fact about somebody's mother.
 *
 * Every cost-bearing path is gated: the access code is checked before Bedrock is
 * touched, utterances are capped, history is capped, and the model call has a small
 * token budget and a short timeout. If Bedrock fails for any reason a keyword router
 * takes over, so the assistant degrades rather than goes silent.
 */

interface LambdaEvent {
  readonly body?: string;
  readonly headers?: Record<string, string | undefined>;
  readonly isBase64Encoded?: boolean;
}

interface LambdaResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const MAX_UTTERANCE = 300;
const MAX_HISTORY = 6;

function json(statusCode: number, body: unknown): LambdaResponse {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

interface Parsed {
  readonly utterance: string;
  readonly demoMinute?: number;
  readonly history: readonly Turn[];
}

export function parseRequest(raw: string): Parsed | { readonly error: string } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: 'body must be JSON' };
  }
  if (typeof body !== 'object' || body === null) return { error: 'body must be an object' };
  const b = body as Record<string, unknown>;

  const utterance = typeof b['utterance'] === 'string' ? b['utterance'].trim() : '';
  if (utterance === '') return { error: 'utterance is required' };
  if (utterance.length > MAX_UTTERANCE) return { error: `utterance is limited to ${MAX_UTTERANCE} characters` };

  const minute = b['demoMinute'];
  const demoMinute =
    typeof minute === 'number' && Number.isInteger(minute) && minute >= 0 && minute <= 1439
      ? minute
      : undefined;

  const history: Turn[] = Array.isArray(b['history'])
    ? (b['history'] as unknown[])
        .slice(-MAX_HISTORY)
        .flatMap((t): Turn[] => {
          if (typeof t !== 'object' || t === null) return [];
          const turn = t as Record<string, unknown>;
          const role = turn['role'];
          const text = turn['text'];
          if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string') return [];
          return [{ role, text: text.slice(0, MAX_UTTERANCE) }];
        })
    : [];

  return { utterance, history, ...(demoMinute === undefined ? {} : { demoMinute }) };
}

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const startedAt = Date.now();

  // Before anything that costs money.
  const access = await checkAccess(event.headers);
  if (!access.allowed) return json(401, { error: 'access code required' });

  const mcpUrl = process.env['MCP_URL'];
  if (mcpUrl === undefined || mcpUrl === '') return json(500, { error: 'assistant misconfigured' });

  const raw =
    event.isBase64Encoded === true && event.body !== undefined
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : (event.body ?? '');
  const request = parseRequest(raw);
  if ('error' in request) return json(400, { error: request.error });

  const residentName = process.env['RESIDENT_NAME'] ?? 'Jasmine';
  const modelId = process.env['ASSISTANT_MODEL_ID'] ?? '';

  let session: McpSession | undefined;
  try {
    const mcpStarted = Date.now();
    session = await openMcpSession({
      url: mcpUrl,
      accessCode: presentedCode(event.headers) ?? '',
      ...(request.demoMinute === undefined ? {} : { demoMinute: request.demoMinute }),
    });
    const connectMs = Date.now() - mcpStarted;

    let route: Route;
    let router: 'bedrock' | 'keywords' = 'keywords';
    let routerNote: string | undefined;
    let modelMs: number | undefined;

    if (modelId === '') {
      route = routeByKeywords(request.utterance);
      routerNote = 'no model configured';
    } else {
      try {
        const chosen = await routeWithBedrock({
          modelId,
          residentName,
          tools: session.tools,
          history: request.history,
          utterance: request.utterance,
        });
        route = chosen.route;
        router = 'bedrock';
        modelMs = chosen.latencyMs;
      } catch (error) {
        route = routeByKeywords(request.utterance);
        routerNote = error instanceof Error ? `${error.name}: ${error.message}` : 'model failed';
      }
    }

    let speech: string;
    let card: Record<string, unknown> | null = null;
    let tool: string | null = null;
    let callMs: number | undefined;

    if (route.kind === 'tool') {
      tool = route.tool;
      const callStarted = Date.now();
      const result = await session.call(route.tool, route.args);
      callMs = Date.now() - callStarted;
      speech = result.isError ? "Sorry, I couldn't do that just now." : result.text;
      card = result.isError ? null : result.structured;
    } else {
      speech = route.text;
    }

    const trace = {
      router,
      ...(routerNote === undefined ? {} : { routerNote }),
      ...(router === 'bedrock' ? { model: modelId } : {}),
      tool,
      protocolVersion: session.protocolVersion,
      server: session.serverVersion,
      toolsDiscovered: session.tools.length,
      timings: {
        connectMs,
        ...(modelMs === undefined ? {} : { modelMs }),
        ...(callMs === undefined ? {} : { toolMs: callMs }),
        totalMs: Date.now() - startedAt,
      },
    };

    // What was asked is not logged — only its length and where it was sent. The
    // questions are about a person, and the logs do not need to know them.
    console.log(
      JSON.stringify({
        message: 'assistant turn',
        utteranceLength: request.utterance.length,
        ...trace,
      }),
    );

    return json(200, { speech, card, trace });
  } catch (error) {
    console.error('assistant turn failed', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : 'unknown',
    });
    return json(502, {
      speech: "Sorry, I can't reach StillThere at the moment.",
      card: null,
      trace: null,
    });
  } finally {
    await session?.close();
  }
}
