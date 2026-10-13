import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CODE = 'jasmine-demo-7Fq2';

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    async send() {
      return { SecretString: `  ${CODE}\n` };
    }
  },
  GetSecretValueCommand: class {
    constructor(public input: unknown) {}
  },
}));

const { checkAccess, resetAccessCache } = await import('../src/handlers/access.js');

describe('access code', () => {
  beforeEach(() => {
    process.env['ACCESS_CODE_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:test';
    resetAccessCache();
  });

  afterEach(() => {
    delete process.env['ACCESS_CODE_SECRET_ARN'];
  });

  it('admits the right code', async () => {
    expect(await checkAccess({ authorization: `Bearer ${CODE}` })).toEqual({ allowed: true });
  });

  it('matches the header name case-insensitively', async () => {
    expect((await checkAccess({ Authorization: `bearer ${CODE}` })).allowed).toBe(true);
  });

  it('refuses a wrong code', async () => {
    const result = await checkAccess({ authorization: 'Bearer guess' });
    expect(result.allowed).toBe(false);
  });

  it('refuses a request with no code', async () => {
    expect((await checkAccess({})).allowed).toBe(false);
    expect((await checkAccess(undefined)).allowed).toBe(false);
  });

  it('refuses a code sent without the Bearer scheme', async () => {
    expect((await checkAccess({ authorization: CODE })).allowed).toBe(false);
  });

  it('fails closed when not configured', async () => {
    // A missing environment variable must not quietly open the endpoint.
    delete process.env['ACCESS_CODE_SECRET_ARN'];
    const result = await checkAccess({ authorization: `Bearer ${CODE}` });
    expect(result.allowed).toBe(false);
  });

  it('never echoes the expected code in a refusal', async () => {
    const result = await checkAccess({ authorization: 'Bearer nope' });
    expect(JSON.stringify(result)).not.toContain(CODE);
  });
});
