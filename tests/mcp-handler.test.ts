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
