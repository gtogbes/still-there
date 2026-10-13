import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { renderView } from '../src/mcp/app-view.js';
import { VIEW_URI, buildMcpServer } from '../src/mcp/server.js';
import type { StatusData } from '../src/mcp/tools.js';

/**
 * The MCP App: the server ships a view, every tool points at it, and the view draws
 * each kind of answer — without ever trusting text it is handed.
 */

const status: StatusData = {
  kind: 'status',
  state: 'overdue',
  severity: 'medium',
  residentName: 'Jasmine',
  dateKey: '2026-11-12',
  nowMinute: 10 * 60 + 30,
  headline: 'No sign of Jasmine being up yet today.',
  detail: 'Usually by 07:37, and it’s 10:30.',
  habits: [
    { key: 'first_activity', name: 'Up and about', label: 'first sign of activity', usualMinute: 457, deadlineMinute: 508, happenedAtMinute: null, state: 'overdue', presentDays: 30, observedDays: 30 },
    { key: 'kitchen', name: 'Kitchen', label: 'activity in the kitchen', usualMinute: 494, deadlineMinute: 557, happenedAtMinute: 500, state: 'done', presentDays: 30, observedDays: 30 },
  ],
  activityMinutes: [],
  ignored: { notAPerson: 3, outside: 8 },
  pausedUntil: null,
  pauseReason: null,
};

describe('the MCP App view', () => {
  it('draws today as rows, with the overdue habit marked', () => {
    const html = renderView(status);
    expect(html).toContain('Something looks different today');
    expect(html).toContain('class="row overdue"');
    expect(html).toContain('not yet · usually 07:37');
    expect(html).toContain('at 08:20');
    expect(html).toContain('NOW 10:30');
  });

  it('escapes anything it is handed', () => {
    const html = renderView({ ...status, headline: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    const pause = renderView({ kind: 'paused', untilDateKey: '2026-11-19', reason: '"><script>x</script>', days: 7 });
    expect(pause).not.toContain('<script>');
  });

  it('falls back to the spoken text for a result it does not recognise', () => {
    expect(renderView(undefined, 'She is up.')).toContain('She is up.');
    expect(renderView({ kind: 'something-new' }, 'Plain answer')).toContain('Plain answer');
  });
});

describe('the server advertises the view', () => {
  async function connect() {
    const server = buildMcpServer({
      tables: { events: 'unused', state: 'unused' },
      householdId: 'household-test',
      now: () => Date.UTC(2026, 10, 12, 10, 30),
    });
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }

  it('links every tool to the ui:// resource', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    for (const tool of tools) {
      expect((tool._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri).toBe(VIEW_URI);
    }
  });

  it('serves a self-contained HTML view with the MCP Apps MIME type', async () => {
    const client = await connect();
    const { contents } = await client.readResource({ uri: VIEW_URI });
    const view = contents[0] as { mimeType?: string; text?: string };
    expect(view.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(view.text).toMatch(/^<!DOCTYPE html>/);
    expect(view.text).toContain('<script type="module">');
    // Self-contained: no external scripts or stylesheets, because the sandbox has
    // no network access to fetch them.
    expect(view.text).not.toMatch(/<script[^>]+src=/);
    expect(view.text).not.toMatch(/<link[^>]+stylesheet/);
  });
});
