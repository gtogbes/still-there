import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { unsafeClaim } from '../narration/validate.js';
import type { McpTool } from './mcp-client.js';
import type { Route, ToolName } from './router.js';

/**
 * Bedrock as the router: from what someone said to which MCP tool to call.
 *
 * The model's job here is deliberately narrow. It chooses a tool and fills in its
 * arguments. It does not answer questions about the person — the tools hold the facts,
 * and the spoken reply is the tool's own deterministic sentence. So a model having a
 * bad day can send a question to the wrong tool, but it cannot invent a fact about
 * somebody's mother.
 *
 * The one exception is a short clarifying question ("how many days?") or a one-line
 * offer of help, and those pass through the same safety check as notifications.
 */

export interface Turn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface BedrockRoute {
  readonly route: Route;
  readonly modelId: string;
  readonly latencyMs: number;
}

const TIMEOUT_MS = 6_000;

let client: BedrockRuntimeClient | undefined;

export function systemPrompt(residentName: string): string {
  return [
    `You are Alexa+, helping a family member keep an eye on ${residentName}, who lives alone, through the StillThere skill.`,
    '',
    'For every request, call exactly one StillThere tool when one fits.',
    `Never answer questions about ${residentName} yourself. The tools hold the facts; you only choose the tool.`,
    'If they want to pause monitoring but have not said for how long, ask how many days in one short sentence instead of calling a tool.',
    'If nothing fits, say in one sentence what you can help with.',
    'Never speculate about health, or about why activity might be missing.',
  ].join('\n');
}

/**
 * MCP tool schemas → Bedrock tool specs.
 *
 * The schemas come from the server's tools/list response at runtime. `$schema` is
 * stripped because Bedrock's validator rejects the key, and nothing else is changed.
 */
export function toBedrockTools(tools: readonly McpTool[]): Tool[] {
  return tools.map((tool) => {
    const { $schema: _ignored, ...schema } = tool.inputSchema;
    return {
      toolSpec: {
        name: tool.name,
        description: tool.description,
        inputSchema: { json: schema as never },
      },
    };
  });
}

/**
 * Bedrock requires strictly alternating turns starting with the user. Browsers send
 * whatever they have, so it is normalised here rather than trusted.
 */
export function toMessages(history: readonly Turn[], utterance: string): Message[] {
  const turns: Turn[] = [...history.slice(-6), { role: 'user', text: utterance }];
  const merged: Turn[] = [];
  for (const turn of turns) {
    const text = turn.text.trim().slice(0, 300);
    if (text === '') continue;
    const last = merged[merged.length - 1];
    if (last !== undefined && last.role === turn.role) {
      merged[merged.length - 1] = { role: turn.role, text: `${last.text} ${text}` };
    } else {
      merged.push({ role: turn.role, text });
    }
  }
  while (merged[0]?.role === 'assistant') merged.shift();
  return merged.map((t) => ({ role: t.role, content: [{ text: t.text }] }));
}

export async function routeWithBedrock(options: {
  readonly modelId: string;
  readonly residentName: string;
  readonly tools: readonly McpTool[];
  readonly history: readonly Turn[];
  readonly utterance: string;
}): Promise<BedrockRoute> {
  const known = new Set(options.tools.map((t) => t.name));
  const startedAt = Date.now();

  client ??= new BedrockRuntimeClient({});
  const response = await client.send(
    new ConverseCommand({
      modelId: options.modelId,
      system: [{ text: systemPrompt(options.residentName) }],
      messages: toMessages(options.history, options.utterance),
      toolConfig: { tools: toBedrockTools(options.tools), toolChoice: { auto: {} } },
      // Routing needs determinism, not creativity, and very few tokens.
      inferenceConfig: { temperature: 0, maxTokens: 200 },
    }),
    { abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
  );

  const latencyMs = Date.now() - startedAt;
  const blocks = response.output?.message?.content ?? [];

  for (const block of blocks) {
    if ('toolUse' in block && block.toolUse !== undefined) {
      const name = block.toolUse.name ?? '';
      if (!known.has(name)) throw new Error(`model chose an unknown tool '${name}'`);
      const input = block.toolUse.input;
      const args =
        typeof input === 'object' && input !== null && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {};
      return { route: { kind: 'tool', tool: name as ToolName, args }, modelId: options.modelId, latencyMs };
    }
  }

  const text = blocks
    .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
    .join(' ')
    .trim();

  if (text === '') throw new Error('model returned neither a tool call nor text');
  if (text.length > 300) throw new Error('model reply too long to speak');
  const unsafe = unsafeClaim(text);
  if (unsafe !== undefined) throw new Error(`model reply rejected: ${unsafe}`);

  return { route: { kind: 'reply', text }, modelId: options.modelId, latencyMs };
}
