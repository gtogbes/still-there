#!/usr/bin/env node
/**
 * Captures screenshots of the deployed web app with headless Chrome, over the
 * DevTools protocol. Used to check the UI visually and to produce images for the
 * README and the submission.
 *
 * The access code is placed in sessionStorage through the protocol, never in a URL,
 * so it does not end up in browser history or a server log.
 *
 * Usage: node scripts/screenshot.mjs <web_url> [outDir]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const url = process.argv[2];
const outDir = process.argv[3] ?? 'docs/screenshots';
if (!url) {
  console.error('usage: node scripts/screenshot.mjs <web_url> [outDir]');
  process.exit(1);
}

let code = '';
for (const line of readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n')) {
  if (line.startsWith('STILL_THERE_ACCESS_CODE=')) code = line.slice(24).trim();
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const profile = join(tmpdir(), `still-there-chrome-${Date.now()}`);
const W = 1500;
const H = 1080;

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome still starting.
    }
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(await target());
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(result.result.data, 'base64'));
  console.log(`  ${outDir}/${name}.png`);
}

async function clickButton(text) {
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (b) b.click(); return !!b; })()`,
  );
}

mkdirSync(outDir, { recursive: true });

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(1500);
  await evaluate(`sessionStorage.setItem('still-there-access', ${JSON.stringify(code)}); true`);
  await send('Page.navigate', { url });
  await sleep(2500);

  // Spoken replies off: headless Chrome has no voices, and it keeps runs quiet.
  await clickButton('Spoken replies on');

  console.log('');
  await clickButton('08:00');
  await sleep(3500);
  await shot('01-0800-nothing-due');

  await clickButton('09:30');
  await sleep(3500);
  await shot('02-0930-overdue');

  await clickButton('12:30');
  await sleep(3500);
  await shot('03-1230-escalated');

  await clickButton('Why did you message me?');
  await sleep(6000);
  await shot('04-why-did-you-message-me');

  await clickButton("What's her normal day like?");
  await sleep(6000);
  await shot('05-normal-day');
  console.log('');
} finally {
  ws.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
