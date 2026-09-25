#!/usr/bin/env node
/**
 * Sweeps the local machine for copies of the Ring credentials.
 *
 * Complements audit-exposure.mjs, which covers git. This one covers the places a
 * leaked value actually comes to rest on a developer machine: temp directories,
 * shell history, and editor or agent session storage.
 *
 * Reports presence only. Nothing found is printed.
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function unquote(value) {
  const t = value.trim();
  if (t.length < 2) return t;
  const q = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  return q ? t.slice(1, -1).trim() : t;
}

const env = {};
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (t === '' || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  env[t.slice(0, eq).trim()] = unquote(t.slice(eq + 1));
}

const needles = [env['RING_CLIENT_ID'], env['RING_CLIENT_SECRET'], env['RING_HMAC_KEY']].filter(
  (v) => typeof v === 'string' && v.length > 12,
);

if (needles.length === 0) {
  console.error('could not read credentials from .env');
  process.exit(1);
}

const MAX_BYTES = 8 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', 'Cache', 'CachedData', 'GPUCache']);

function fileHasSecret(path) {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_BYTES || stat.size === 0) return false;
    const text = readFileSync(path, 'latin1');
    return needles.some((n) => text.includes(n));
  } catch {
    return false;
  }
}

function walk(dir, depth, found) {
  if (depth < 0 || found.length > 0) return found;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (found.length > 0) return found;
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, depth - 1, found);
    else if (entry.isFile() && fileHasSecret(path)) found.push(path);
  }
  return found;
}

const home = homedir();

const targets = [
  ['Project .env (expected — this is the source)', join(root, '.env'), 'file'],
  ['System temp directory', tmpdir(), 'tree'],
  ['macOS per-user temp (/var/folders)', '/var/folders', 'tree'],
  ['/tmp', '/tmp', 'tree'],
  ['zsh history', join(home, '.zsh_history'), 'file'],
  ['bash history', join(home, '.bash_history'), 'file'],
  ['Kiro user config (~/.kiro)', join(home, '.kiro'), 'tree'],
  ['Kiro app support', join(home, 'Library', 'Application Support', 'Kiro'), 'tree'],
  ['AWS CLI cache', join(home, '.aws'), 'tree'],
];

console.log('\nLocal sweep for credential copies\n');

let unexpected = 0;

for (const [label, path, kind] of targets) {
  if (!existsSync(path)) {
    console.log(`  absent   ${label}`);
    continue;
  }

  const found = kind === 'file' ? (fileHasSecret(path) ? [path] : []) : walk(path, 6, []);
  const isSource = label.startsWith('Project .env');

  if (found.length === 0) {
    console.log(`  clean    ${label}`);
  } else if (isSource) {
    console.log(`  expected ${label}`);
  } else {
    unexpected += 1;
    // Print the path, never the contents.
    console.log(`  FOUND    ${label} → ${found[0]}`);
  }
}

console.log(
  `\n${unexpected === 0 ? 'No unexpected copies on disk. The only file holding these values is .env.' : `${unexpected} unexpected copy/copies on disk.`}\n`,
);
