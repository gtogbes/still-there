import { afterEach, describe, expect, it } from 'vitest';
import { handler } from '../src/handlers/home.js';

/**
 * The landing page is public and unauthenticated. These pin what it may and may not
 * contain: it must point at the live demo and the MCP server, and must stay free of
 * script so its CSP can stay at default-src 'none'.
 */

describe('landing page', () => {
  afterEach(() => {
    delete process.env['WEB_URL'];
    delete process.env['MCP_URL'];
  });

  it('links to the simulated device and the MCP endpoint', async () => {
    process.env['WEB_URL'] = 'https://web.example';
    process.env['MCP_URL'] = 'https://api.example/mcp';
    const { body } = await handler();
    expect(body).toContain('href="https://web.example"');
    expect(body).toContain('https://api.example/mcp');
    expect(body).toContain('2025-11-25');
  });

  it('falls back when no custom domain is configured', async () => {
    // Terraform sets WEB_URL to "" when web_domain is unset, and an empty link
    // would render a button that goes nowhere.
    process.env['WEB_URL'] = '';
    const { body } = await handler();
    expect(body).toContain('href="https://stillthere.ogbes.com"');
    expect(body).not.toContain('href=""');
  });

  it('says plainly what is simulated', async () => {
    const { body } = await handler();
    expect(body).toMatch(/Simulated:/);
    expect(body).toMatch(/synthetic resident/);
  });

  it('carries no script, so the tight CSP holds', async () => {
    const { body, headers } = await handler();
    expect(body).not.toMatch(/<script/i);
    expect(headers['Content-Security-Policy']).toContain("default-src 'none'");
  });

  it('escapes configured links', async () => {
    process.env['WEB_URL'] = 'https://x.example/"><img src=x>';
    const { body } = await handler();
    expect(body).not.toContain('"><img');
  });
});
