#!/usr/bin/env node
/**
 * Mobile screenshots of the deployed web app, via headless Chrome over CDP.
 *
 * Separate from screenshot.mjs because a phone needs device metrics emulation and
 * full-page capture: the interesting failures are things pushed below the fold or
 * squeezed sideways, which a viewport-sized shot hides.
 *
 * Usage: node scripts/screenshot-mobile.mjs <web_url> [outDir]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const url = process.argv[2];
const outDir = process.argv[3] ?? '/tmp/st-mobile';
if (!url) {
  console.error('usage: node scripts/screenshot-mobile.mjs <web_url> [outDir]');
  process.exit(1);
}

let code = '';
for (const line of readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n')) {
  if (line.startsWith('STILL_THERE_ACCESS_CODE=')) code = line.slice(24).trim();
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9335;
const profile = join(tmpdir(), `st-mobile-${Date.now()}`);

// iPhone 14 logical viewport, and a small Android for the narrowest realistic case.
const DEVICES = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  small: { width: 360, height: 780, deviceScaleFactor: 2, mobile: true },
  tablet: { width: 834, height: 1112, deviceScaleFactor: 2, mobile: true },
};

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=390,844',
    '--hide-scrollbars',
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
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true, // the whole page, not just the fold
  });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(result.result.data, 'base64'));
  console.log(`  ${outDir}/${name}.png`);
}

async function clickButton(text) {
  return evaluate(
    `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (b) b.click(); return !!b; })()`,
  );
}

/** Anything wider than the viewport is a horizontal-scroll bug. */
async function overflow() {
  return evaluate(`(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().width > vw + 1)
      .map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''));
    return JSON.stringify({ docWidth: document.documentElement.scrollWidth, viewport: vw, tooWide: [...new Set(wide)].slice(0, 6) });
  })()`);
}

mkdirSync(outDir, { recursive: true });

try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', DEVICES.phone);
  await send('Page.navigate', { url });
  await sleep(1500);
  await evaluate(`sessionStorage.setItem('still-there-access', ${JSON.stringify(code)}); true`);
  await send('Page.navigate', { url });
  await sleep(3000);
  await clickButton('Spoken replies on');

  console.log('');
  for (const [label, metrics] of Object.entries(DEVICES)) {
    await send('Emulation.setDeviceMetricsOverride', metrics);
    await sleep(1200);
    console.log(`  ${label} ${metrics.width}x${metrics.height}  overflow: ${await overflow()}`);
    await shot(`${label}-01-ambient`);
  }

  // Back to the phone for the interaction states.
  await send('Emulation.setDeviceMetricsOverride', DEVICES.phone);
  await sleep(800);
  await clickButton('12:30');
  await sleep(3500);
  await shot('phone-02-escalated');
  await clickButton('Why did you message me?');
  await sleep(6000);
  await shot('phone-03-explain');
  await clickButton("What's her normal day like?");
  await sleep(6000);
  await shot('phone-04-routine');
  console.log('');
} finally {
  ws.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
