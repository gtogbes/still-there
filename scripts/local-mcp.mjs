#!/usr/bin/env node
/**
 * Runs the StillThere MCP server on localhost, against the deployed tables.
 *
 * For testing MCP clients that cannot send our access-code header — chiefly the
 * MCP Apps reference host (ext-apps/examples/basic-host), which is how the
 * `ui://` view is checked in a real host before anyone else sees it.
 *
 * Bound to 127.0.0.1 and unauthenticated, so it is reachable from this machine
 * only. It uses your AWS credentials, so pause_monitoring through it really does
 * pause the dev household; resume_monitoring undoes it.
 *
 * Usage:
 *   npm run build:lambda
 *   AWS_PROFILE=gt node dist/tools/local-mcp.mjs [--port 3001] [--demo-minute 630]
 */
import { createServer } from 'node:http';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildMcpServer } from '../src/mcp/server.ts';
import { clockFor } from '../src/mcp/demo-clock.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || args[i + 1] === undefined ? fallback : args[i + 1];
};

const port = Number(flag('port', '3001'));
const stack = flag('stack', 'still-there-dev');
const demoMinute = flag('demo-minute', undefined);
const tables = { events: `${stack}-events`, state: `${stack}-state` };
const householdId = flag('household', 'household-primary');

const http = createServer(async (req, res) => {
  // CORS, because the reference host calls from another localhost port.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, mcp-protocol-version');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (!req.url?.startsWith('/mcp')) {
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  try {
    const message = JSON.parse(body);
    const tool = message.params?.name ?? message.params?.uri ?? '';
    console.log(`${new Date().toISOString().slice(11, 19)}  ${message.method ?? '(response)'} ${tool}`);
  } catch {
    // GET or empty body; nothing to log.
  }

  const server = buildMcpServer({
    tables,
    householdId,
    now: clockFor(demoMinute === undefined ? undefined : Number(demoMinute), true),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  try {
    await server.connect(transport);
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
      ...(req.method === 'POST' ? { body } : {}),
    });
    const response = await transport.handleRequest(request);
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.writeHead(response.status).end(await response.text());
  } catch (error) {
    console.error(error);
    res.writeHead(500).end();
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

http.listen(port, '127.0.0.1', () => {
  console.log(`StillThere MCP on http://127.0.0.1:${port}/mcp (local only, no auth)`);
  if (demoMinute !== undefined) console.log(`  answering as of minute ${demoMinute} today`);
});
