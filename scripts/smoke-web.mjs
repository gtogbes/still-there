#!/usr/bin/env node
/**
 * End-to-end check of the public deployment, through CloudFront, the way a judge's
 * browser would reach it.
 *
 * Covers the page itself and its security headers, the access code being enforced on
 * both API paths, the ambient MCP read, and the assistant routing real utterances
 * through Bedrock to the right tool. The pause is resumed at the end so the demo
 * household is left as it was found.
 *
 * Usage:  node scripts/smoke-web.mjs https://<distribution>.cloudfront.net
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2];
if (!base) {
  console.error('usage: node scripts/smoke-web.mjs <web_url>');
  process.exit(1);
}

let code = '';
for (const line of readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n')) {
  if (line.startsWith('STILL_THERE_ACCESS_CODE=')) code = line.slice('STILL_THERE_ACCESS_CODE='.length).trim();
}
if (!code) {
  console.error('STILL_THERE_ACCESS_CODE not found in .env');
  process.exit(1);
}

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

console.log(`\n${base}\n`);

// The page
const page = await fetch(`${base}/`);
const csp = page.headers.get('content-security-policy') ?? '';
check(page.status === 200, 'page loads', `HTTP ${page.status}`);
check(csp.includes("default-src 'self'"), 'content security policy present');
check((page.headers.get('permissions-policy') ?? '').includes('microphone=(self)'), 'microphone allowed for this origin only');

// Access control on both API paths
const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'still_there_status', arguments: {} } };
const mcpHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' };

const noCode = await fetch(`${base}/api/mcp`, { method: 'POST', headers: mcpHeaders, body: JSON.stringify(rpc) });
check(noCode.status === 401, 'MCP refuses a request without the code', `HTTP ${noCode.status}`);

const noCodeAssistant = await fetch(`${base}/api/assistant`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ utterance: 'Is Jasmine up yet?' }),
});
check(noCodeAssistant.status === 401, 'assistant refuses before touching Bedrock', `HTTP ${noCodeAssistant.status}`);

// Ambient read, no model involved
const ambient = await fetch(`${base}/api/mcp`, {
  method: 'POST',
  headers: { ...mcpHeaders, 'x-still-there-access': code, 'x-still-there-demo-minute': '570' },
  body: JSON.stringify(rpc),
});
const ambientBody = await ambient.json();
const status = ambientBody.result?.structuredContent;
check(ambient.status === 200 && status?.kind === 'status', 'ambient status read through CloudFront', status ? `${status.state} at ${status.nowMinute}` : `HTTP ${ambient.status}`);

// The assistant
async function ask(utterance, demoMinute) {
  const response = await fetch(`${base}/api/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-still-there-access': code },
    body: JSON.stringify({ utterance, demoMinute, history: [] }),
  });
  return { status: response.status, body: await response.json() };
}

const turns = [
  ['Is Jasmine up yet?', 480, 'still_there_status'],
  ['Is Jasmine up yet?', 570, 'still_there_status'],
  ['Why did you message me?', 600, 'explain_last_alert'],
  ["What's her normal day like?", 600, 'describe_routine'],
  ["She's away for a week visiting her sister", 600, 'pause_monitoring'],
  ["She's back", 600, 'resume_monitoring'],
];

console.log('');
for (const [utterance, minute, expected] of turns) {
  const { status: code200, body } = await ask(utterance, minute);
  const t = body.trace;
  check(
    code200 === 200 && t?.tool === expected,
    `"${utterance}" @ ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')} → ${expected}`,
    t ? `${t.router}, ${t.timings.totalMs} ms, protocol ${t.protocolVersion}` : `HTTP ${code200}`,
  );
  if (body.speech) console.log(`          ${body.speech.slice(0, 150)}${body.speech.length > 150 ? '…' : ''}`);
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
