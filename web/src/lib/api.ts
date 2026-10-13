import type { AssistantReply, Card, Turn } from '../types';

/**
 * Two ways the app talks to the backend, and the distinction matters for cost.
 *
 *   ask()      — the assistant. Bedrock chooses an MCP tool. One call per question.
 *   readTool() — straight to the MCP server, no model involved. Used for the ambient
 *                display that refreshes as the demo clock moves, so dragging a slider
 *                never runs up a Bedrock bill.
 *
 * Both go to same-origin /api paths: CloudFront in production, the Vite proxy in
 * development. The access code travels in a custom header rather than
 * Authorization, which CloudFront forwards without special cache-policy setup.
 */

const ACCESS_HEADER = 'x-still-there-access';
const DEMO_MINUTE_HEADER = 'x-still-there-demo-minute';

export class AccessDenied extends Error {
  constructor() {
    super('access code not accepted');
    this.name = 'AccessDenied';
  }
}

export async function ask(options: {
  utterance: string;
  demoMinute: number;
  history: Turn[];
  accessCode: string;
  signal?: AbortSignal;
}): Promise<AssistantReply> {
  const response = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [ACCESS_HEADER]: options.accessCode },
    body: JSON.stringify({
      utterance: options.utterance,
      demoMinute: options.demoMinute,
      history: options.history.slice(-6),
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 401) throw new AccessDenied();
  const body = (await response.json()) as AssistantReply;
  if (!response.ok && !body.speech) throw new Error(`assistant returned ${response.status}`);
  return body;
}

let rpcId = 0;

export async function readTool<T extends Card>(options: {
  tool: 'still_there_status' | 'explain_last_alert' | 'describe_routine';
  demoMinute: number;
  accessCode: string;
  signal?: AbortSignal;
}): Promise<{ text: string; data: T | null }> {
  rpcId += 1;
  const response = await fetch('/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
      [ACCESS_HEADER]: options.accessCode,
      [DEMO_MINUTE_HEADER]: String(options.demoMinute),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcId,
      method: 'tools/call',
      params: { name: options.tool, arguments: {} },
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 401) throw new AccessDenied();
  if (!response.ok) throw new Error(`MCP returned ${response.status}`);

  const payload = (await response.json()) as {
    result?: { content?: { type: string; text?: string }[]; structuredContent?: T };
    error?: { message: string };
  };
  if (payload.error) throw new Error(payload.error.message);

  const text = (payload.result?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join(' ');
  return { text, data: payload.result?.structuredContent ?? null };
}
