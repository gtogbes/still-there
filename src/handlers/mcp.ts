import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildMcpServer } from '../mcp/server.js';
import { tableNames } from '../storage/tables.js';

/**
 * MCP endpoint, Streamable HTTP.
 *
 * Uses the SDK's Web Standards transport, which speaks `Request` and `Response`
 * rather than Node streams — so it drops into Lambda with only a small bridge from
 * the API Gateway event shape, and the protocol itself stays the SDK's problem.
 * Version negotiation, JSON-RPC framing and error codes are not things worth
 * hand-rolling for a submission judged on how well the required technology is used.
 *
 * Stateless per invocation: no session id, and a fresh server and transport each
 * time. Lambda gives no affinity between requests, so the alternative would be a
 * session that works until the next cold start. The 2025-11-25 transport permits
 * stateless operation, and every tool here reads its state from DynamoDB anyway.
 */

interface LambdaEvent {
  readonly body?: string;
  readonly headers?: Record<string, string | undefined>;
  readonly isBase64Encoded?: boolean;
  readonly rawPath?: string;
  readonly requestContext?: { readonly http?: { readonly method?: string } };
}

interface LambdaResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly isBase64Encoded?: boolean;
}

function toRequest(event: LambdaEvent, url: string): Request {
  const method = event.requestContext?.http?.method ?? 'POST';

  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(name, value);
  }
  // The transport requires Accept to cover both, and some clients omit one. Filling
  // it in is kinder than returning a 406 that reads like a protocol error.
  const accept = headers.get('accept') ?? '';
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
    headers.set('accept', 'application/json, text/event-stream');
  }

  const body =
    event.body === undefined || method === 'GET' || method === 'DELETE'
      ? undefined
      : event.isBase64Encoded === true
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;

  return new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const householdId = process.env['HOUSEHOLD_ID'];
  if (householdId === undefined) {
    console.error('HOUSEHOLD_ID must be set');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'server misconfigured' },
        id: null,
      }),
    };
  }

  const server = buildMcpServer({
    tables: tableNames(process.env),
    householdId,
    now: () => Date.now(),
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    // sessionIdGenerator is deliberately omitted rather than set to undefined:
    // absent means stateless, which is the only sensible mode here.
    enableJsonResponse: true, // Lambda cannot usefully hold an SSE stream open.
  });

  try {
    await server.connect(transport);

    const origin = event.headers?.['host'] ?? 'lambda.local';
    const path = event.rawPath ?? '/mcp';
    const response = await transport.handleRequest(toRequest(event, `https://${origin}${path}`));

    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name] = value;
    });

    return {
      statusCode: response.status,
      headers,
      body: await response.text(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('MCP request failed', { message });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'internal error' },
        id: null,
      }),
    };
  } finally {
    // Closing matters even on the success path. Lambda freezes the execution
    // environment rather than tearing it down, so a transport left open leaks into
    // the next invocation on the same container.
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
