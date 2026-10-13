import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { DEMO_MINUTE_HEADER } from '../mcp/demo-clock.js';

/**
 * The assistant's connection to the StillThere MCP server.
 *
 * Over HTTP, through API Gateway, exactly as any third-party MCP client would
 * connect — not an in-process shortcut. That is the point: the assistant is a
 * consumer of the server, and every request it makes proves the public endpoint
 * works, including the access check.
 *
 * Tools are discovered with tools/list at runtime rather than hardcoded, so adding
 * a tool to the server makes it available to the assistant with no change here.
 */

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  readonly text: string;
  readonly structured: Record<string, unknown> | null;
  readonly isError: boolean;
}

export interface McpSession {
  readonly tools: readonly McpTool[];
  readonly protocolVersion: string;
  readonly serverVersion: string;
  call(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  close(): Promise<void>;
}

export async function openMcpSession(options: {
  readonly url: string;
  readonly accessCode: string;
  readonly demoMinute?: number;
}): Promise<McpSession> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessCode}`,
  };
  if (options.demoMinute !== undefined) headers[DEMO_MINUTE_HEADER] = String(options.demoMinute);

  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: { headers },
  });
  const client = new Client({ name: 'still-there-assistant', version: '0.2.0' });

  // The SDK's own transport does not satisfy its own Transport interface under
  // exactOptionalPropertyTypes (sessionId is `string | undefined` on one, optional
  // `string` on the other). A typing quirk, not a runtime one — hence the cast.
  await client.connect(transport as unknown as Transport);
  const listed = await client.listTools();

  const tools: McpTool[] = listed.tools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));

  const server = client.getServerVersion();

  return {
    tools,
    protocolVersion: transport.protocolVersion ?? 'unknown',
    serverVersion: server === undefined ? 'unknown' : `${server.name} ${server.version}`,
    async call(name, args) {
      const result = await client.callTool({ name, arguments: args });
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((block) =>
          typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block
            ? String(block.text)
            : '',
        )
        .join(' ')
        .trim();
      const structured =
        typeof result.structuredContent === 'object' && result.structuredContent !== null
          ? (result.structuredContent as Record<string, unknown>)
          : null;
      return { text, structured, isError: result.isError === true };
    },
    async close() {
      await client.close().catch(() => {});
    },
  };
}
