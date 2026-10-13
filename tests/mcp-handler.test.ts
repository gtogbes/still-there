import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handler } from '../src/handlers/mcp.js';

/**
 * The parts of the MCP endpoint that are decided before any data is read: refusing
 * strangers, and refusing them in the shape Alexa+ expects.
 */

describe('MCP endpoint access', () => {
  beforeEach(() => {
    process.env['HOUSEHOLD_ID'] = 'household-test';
    process.env['ACCESS_CODE_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:test';
  });

  afterEach(() => {
    delete process.env['HOUSEHOLD_ID'];
    delete process.env['ACCESS_CODE_SECRET_ARN'];
  });

  it('answers a request with no code with a bare 401', async () => {
    const response = await handler({
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      headers: { 'content-type': 'application/json' },
      requestContext: { http: { method: 'POST' } },
    });
    expect(response.statusCode).toBe(401);
    // The Alexa+ MCP requirements ask for 401 without WWW-Authenticate.
    expect(Object.keys(response.headers).map((h) => h.toLowerCase())).not.toContain('www-authenticate');
    expect(JSON.parse(response.body).error.message).toMatch(/Bearer/);
  });

  it('refuses a browser from an unknown origin with 403, before the access check', async () => {
    // Streamable HTTP: servers MUST validate Origin and answer an invalid one with 403.
    process.env['ALLOWED_ORIGINS'] = 'https://stillthere.example';
    const response = await handler({
      body: '{}',
      headers: { origin: 'https://evil.example', authorization: 'Bearer anything' },
      requestContext: { http: { method: 'POST' } },
    });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).id).toBeNull();
    delete process.env['ALLOWED_ORIGINS'];
  });

  it('lets an allowed origin through to the access check', async () => {
    process.env['ALLOWED_ORIGINS'] = 'https://stillthere.example, https://d1.cloudfront.net';
    const response = await handler({
      body: '{}',
      headers: { origin: 'https://d1.cloudfront.net' },
      requestContext: { http: { method: 'POST' } },
    });
    expect(response.statusCode).toBe(401); // past the Origin check, stopped by the code
    delete process.env['ALLOWED_ORIGINS'];
  });

  it('answers GET and DELETE with 405 and an Allow header', async () => {
    // The spec: GET must open an SSE stream or return 405. This server has no stream.
    for (const method of ['GET', 'DELETE']) {
      const response = await handler({ headers: {}, requestContext: { http: { method } } });
      expect(response.statusCode).toBe(405);
      expect(response.headers['Allow']).toBe('POST');
    }
  });

  it('fails closed when access control is not configured', async () => {
    delete process.env['ACCESS_CODE_SECRET_ARN'];
    const response = await handler({
      body: '{}',
      headers: { authorization: 'Bearer anything' },
      requestContext: { http: { method: 'POST' } },
    });
    expect(response.statusCode).toBe(401);
  });
});
