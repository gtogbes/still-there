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

const HANDLERS = ['webhook', 'token', 'link', 'home', 'assess'];

/**
 * Operator scripts that import domain code.
 *
 * They go through esbuild for one specific reason: the TypeScript sources use `.js`
 * import specifiers, which is correct for NodeNext, and Node's built-in type
 * stripping does not rewrite them to `.ts`. esbuild does, so the tools get bundled
 * the same way the handlers do rather than growing a parallel import convention.
 */
const TOOLS = ['seed-household'];

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

const tools = await build({
  entryPoints: TOOLS.map((name) => join(root, 'scripts', `${name}.mjs`)),
  outdir: join(root, 'dist', 'tools'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  minify: false,
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});

if (tools.errors.length > 0) {
  console.error(tools.errors);
  process.exit(1);
}

console.log(
  `\nBundled ${HANDLERS.length} handlers into dist/handlers and ${TOOLS.length} tool(s) into dist/tools\n`,
);
