#!/usr/bin/env node
/**
 * Minimal MCP client, for testing the deployed server by hand.
 *
 * Speaks enough Streamable HTTP to do the handshake and call a tool, so the endpoint
 * can be exercised without wiring up a full assistant. Useful for the demo too: it
 * shows the protocol working rather than asking anyone to take it on trust.
 *
 * Usage:
 *   node scripts/mcp-call.mjs <url>                       # handshake + list tools
 *   node scripts/mcp-call.mjs <url> still_there_status
 *   node scripts/mcp-call.mjs <url> pause_monitoring '{"days":7,"reason":"in Lagos"}'
 */

const [url, toolName, rawArgs] = process.argv.slice(2);

if (url === undefined) {
  console.error('usage: node scripts/mcp-call.mjs <url> [tool] [jsonArgs]');
  process.exit(1);
}

const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'MCP-Protocol-Version': '2025-11-25',
};

let nextId = 1;

async function rpc(method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) }),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);

  // enableJsonResponse is on, so this is plain JSON. An SSE-framed reply is handled
  // anyway, because a future spec revision or a config change could switch it.
  const payload = text.startsWith('event:') || text.startsWith('data:')
    ? JSON.parse(text.replace(/^.*?data:\s*/s, '').split('\n')[0])
    : JSON.parse(text);

  if (payload.error) throw new Error(`${payload.error.code}: ${payload.error.message}`);
  return payload.result;
}

const dim = (s) => `\u001b[2m${s}\u001b[0m`;
const bold = (s) => `\u001b[1m${s}\u001b[0m`;
const cyan = (s) => `\u001b[36m${s}\u001b[0m`;

const init = await rpc('initialize', {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'still-there-cli', version: '0.1.0' },
});

console.log(`\n${bold('connected')}  ${init.serverInfo.name} v${init.serverInfo.version}`);
console.log(dim(`protocol  ${init.protocolVersion}`));

if (toolName === undefined) {
  const { tools } = await rpc('tools/list');
  console.log(`\n${bold(`${tools.length} tools`)}\n`);
  for (const tool of tools) {
    const required = tool.inputSchema?.required ?? [];
    console.log(`  ${cyan(tool.name)}${required.length > 0 ? dim(`  (${required.join(', ')})`) : ''}`);
    console.log(dim(`    ${tool.description}`));
  }
  console.log('');
  process.exit(0);
}

const args = rawArgs === undefined ? {} : JSON.parse(rawArgs);
const result = await rpc('tools/call', { name: toolName, arguments: args });

console.log(`\n${bold(toolName)}${rawArgs ? dim(`  ${rawArgs}`) : ''}\n`);
for (const block of result.content ?? []) {
  if (block.type !== 'text') continue;
  // Wrapped, because these answers are meant to be spoken and read back.
  let line = '';
  for (const word of block.text.split(' ')) {
    if ((line + word).length > 72) {
      console.log(`  ${line.trimEnd()}`);
      line = '';
    }
    line += `${word} `;
  }
  if (line.trim() !== '') console.log(`  ${line.trimEnd()}`);
}
console.log('');
