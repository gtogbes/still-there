#!/usr/bin/env node
/**
 * Bundles each handler into a single .mjs file for Lambda.
 *
 * Bundling rather than shipping node_modules: the AWS SDK alone is tens of
 * megabytes, and a smaller artefact means a shorter cold start. That matters on
 * the token exchange path in particular, where Ring's authorisation code is valid
 * for sixty seconds and there is no warning it is about to arrive.
 *
 * The SDK is bundled too rather than relying on the runtime's copy, so the version
 * we tested is the version that runs.
 */

import { build } from 'esbuild';
import { rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'dist', 'handlers');

const HANDLERS = ['webhook', 'token', 'link', 'home'];

await rm(join(root, 'dist'), { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const result = await build({
  entryPoints: HANDLERS.map((name) => join(root, 'src', 'handlers', `${name}.ts`)),
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  minify: false, // Readable stack traces are worth more than a few kilobytes.
  outExtension: { '.js': '.mjs' },
  logLevel: 'info',
  // ESM output needs this shim: bundled CJS dependencies still reach for
  // `require`, which does not exist in an ES module.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});

if (result.errors.length > 0) {
  console.error(result.errors);
  process.exit(1);
}

console.log(`\nBundled ${HANDLERS.length} handlers into dist/handlers\n`);
