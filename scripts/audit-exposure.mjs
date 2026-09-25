#!/usr/bin/env node
/**
 * Searches the places a credential could have come to rest, and reports only
 * whether each one is clean.
 *
 * Reads the live values from .env purely so it can look for them. Nothing it finds
 * is ever printed — the whole point is to answer "is it in there" without adding
 * another copy to a log somewhere.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function unquote(value) {
  const t = value.trim();
  if (t.length < 2) return t;
  const quoted = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  return quoted ? t.slice(1, -1).trim() : t;
}

const env = {};
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (t === '' || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  env[t.slice(0, eq).trim()] = unquote(t.slice(eq + 1));
}

const secrets = [
  ['RING_CLIENT_ID', env['RING_CLIENT_ID']],
  ['RING_CLIENT_SECRET', env['RING_CLIENT_SECRET']],
  ['RING_HMAC_KEY', env['RING_HMAC_KEY']],
].filter(([, v]) => typeof v === 'string' && v.length > 8);

if (secrets.length === 0) {
  console.error('could not read credentials from .env');
  process.exit(1);
}

let problems = 0;
const report = (label, clean, detail = '') => {
  if (!clean) problems += 1;
  console.log(`  ${clean ? 'clean ' : 'FOUND '} ${label}${detail === '' ? '' : ` — ${detail}`}`);
};

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return '';
  }
}

console.log('\nGit history (all branches, all commits, including diffs)\n');
const history = git(['log', '-p', '--all', '--full-history']);
for (const [name, value] of secrets) {
  report(`${name} in git history`, !history.includes(value));
}

console.log('\nTracked files in the current tree\n');
const tracked = git(['ls-files']).split('\n').filter(Boolean);
report('.env is untracked', !tracked.includes('.env'));
report('terraform.tfvars is untracked', !tracked.includes('terraform/terraform.tfvars'));
report(
  'no tfstate is tracked',
  !tracked.some((f) => f.includes('.tfstate')),
);

console.log('\nWorking tree files that git can see\n');
for (const [name, value] of secrets) {
  let hit = false;
  for (const file of tracked) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    try {
      if (readFileSync(path, 'utf8').includes(value)) {
        hit = true;
        break;
      }
    } catch {
      // Binary or unreadable. Not a place a pasted credential lives.
    }
  }
  report(`${name} in any tracked file`, !hit);
}

console.log('\nLocal Terraform state\n');
for (const stateFile of ['terraform/terraform.tfstate', 'terraform/terraform.tfstate.backup']) {
  const path = join(root, stateFile);
  if (!existsSync(path)) {
    console.log(`  absent  ${stateFile}`);
    continue;
  }
  const contents = readFileSync(path, 'utf8');
  let hit = false;
  for (const [, value] of secrets) if (contents.includes(value)) hit = true;
  report(`${stateFile}`, !hit, hit ? 'real credentials present in state' : 'placeholders only');
}

console.log(
  `\n${problems === 0 ? 'No credential found in git, tracked files, or Terraform state.' : `${problems} location(s) need attention.`}\n`,
);
process.exit(problems === 0 ? 0 : 1);
