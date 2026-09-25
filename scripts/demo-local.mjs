#!/usr/bin/env node
/**
 * Offline demonstration of the whole reasoning pipeline.
 *
 * Runs in about a second with no AWS account, no Ring account and no credentials, so
 * anyone who clones the repository can watch the product work rather than take our
 * word for it.
 *
 * On the honesty of "compressed time": nothing here is faked. The events carry real
 * timestamps in a real calendar — 07:31 is 07:31 — and the only liberty taken is
 * asking the system what it thinks at chosen moments instead of waiting for them to
 * arrive. That is possible because no code in src/domain reads the clock; every
 * function takes the instant it should reason about as an argument.
 *
 * Usage:
 *   npm run demo
 */

import { deadlineMinute, learnBaseline } from '../src/domain/baseline.ts';
import { assess, blindSpots, deviations, peakSeverity } from '../src/domain/deviation.ts';
import { occupancyEvents } from '../src/domain/occupancy.ts';
import { addDays, dayClassOf, formatMinute, fromLocal, weekdayOf } from '../src/domain/time.ts';
import { fallbackNarration } from '../src/narration/validate.ts';
import { generateHistory, eventsOnDate, healthySnapshot, blindSnapshot } from '../src/testing/generator.ts';
import { ese } from '../src/testing/personas.ts';

const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';
const GREEN = '\u001b[32m';
const AMBER = '\u001b[33m';
const CYAN = '\u001b[36m';

const bold = (s) => `${BOLD}${s}${RESET}`;
const dim = (s) => `${DIM}${s}${RESET}`;
const green = (s) => `${GREEN}${s}${RESET}`;
const amber = (s) => `${AMBER}${s}${RESET}`;
const cyan = (s) => `${CYAN}${s}${RESET}`;

const pause = (ms) =>
  process.env['DEMO_FAST'] === '1' ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

function rule() {
  console.log(dim('─'.repeat(74)));
}

function step(n, total, title) {
  console.log(`\n${bold(`[${n}/${total}]`)} ${bold(title)}`);
}

const TZ = ese.config.timeZone;
const LEARN_DAYS = 42;
const HISTORY_START = '2026-08-01';

/**
 * Both demonstration days must be working days.
 *
 * Weekday and weekend routines are learned separately, and an earlier version of this
 * script happened to land the interesting day on a Saturday — so it compared against
 * twelve weekend days while the habits printed above it were the thirty weekday ones.
 * Correct behaviour, thoroughly confusing demonstration.
 */
function nextWorkingDay(from, offset) {
  let candidate = addDays(from, offset);
  while (dayClassOf(weekdayOf(candidate)) !== 'weekday') {
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

const NORMAL_DAY = nextWorkingDay(HISTORY_START, LEARN_DAYS);
const BAD_DAY = nextWorkingDay(NORMAL_DAY, 1);

console.log(`
${bold('StillThere')} ${dim('— it notices the things that did not happen')}
`);
rule();
console.log(`
Ese is 82 and lives alone. Her Ring devices already record when she moves around
the house. This is what StillThere does with that.

${dim('Time is compressed, not faked. Every event below carries a real timestamp;')}
${dim('we simply ask the system what it thinks at chosen moments rather than waiting.')}
`);
rule();

// ── 1. Learn ────────────────────────────────────────────────────────────────

step(1, 5, `Learning Ese's routine from ${LEARN_DAYS} days of history`);
await pause(600);

const history = generateHistory(ese, { startDateKey: HISTORY_START, days: LEARN_DAYS, seed: 41 });
const occupancy = occupancyEvents(history, ese.config);
const baseline = learnBaseline(history, ese.config);

console.log(
  dim(
    `      ${history.length} events recorded, of which ${occupancy.length} are evidence somebody was up`,
  ),
);
console.log(dim(`      ${history.length - occupancy.length} were the street or the cat`));
console.log('');

const weekday = baseline.anchors.filter((a) => a.dayClass === 'weekday');
console.log(`      ${bold(`${weekday.length} habits learned for a working day:`)}`);
for (const anchor of weekday) {
  console.log(
    `        ${anchor.label.padEnd(28)} ${cyan(`usually by ${formatMinute(anchor.medianMinute)}`)}` +
      dim(`   held ${anchor.presentDays}/${anchor.observedDays} days`),
  );
}
console.log(
  dim(
    `\n      Habits below 95% reliability are discarded. Ese does laundry upstairs on\n` +
      `      Tuesdays and Fridays — that is 40% of working days, so it is not a habit\n` +
      `      and alerting on its absence would be noise.`,
  ),
);
await pause(2500);

// ── 2. A normal day ─────────────────────────────────────────────────────────

step(2, 5, 'An ordinary day. Asking the system at midday');
await pause(600);

const normalEvents = eventsOnDate(
  generateHistory(ese, { startDateKey: NORMAL_DAY, days: 1, seed: 77 }),
  NORMAL_DAY,
  TZ,
);
const noonNormal = fromLocal(NORMAL_DAY, 12 * 60, TZ);
const normal = assess({
  baseline,
  config: ese.config,
  todaysEvents: normalEvents,
  health: healthySnapshot(ese, noonNormal),
  evaluatedAt: noonNormal,
});

console.log(dim(`      ${normalEvents.length} events so far today`));
if (normal.findings.length === 0) {
  console.log(`\n      ${green('Nothing to report.')}`);
  console.log(dim('      This is the product working. Most days it says nothing at all.'));
} else {
  console.log(amber(`\n      ${normal.findings.length} findings — unexpected on a normal day`));
}
await pause(2500);

// ── 3. The bad day, too early to tell ───────────────────────────────────────

step(3, 5, "Another day. Ese doesn't come downstairs. Asking at 08:00");
await pause(600);

const badEvents = eventsOnDate(
  generateHistory(ese, { startDateKey: BAD_DAY, days: 1, seed: 91, omit: () => true }),
  BAD_DAY,
  TZ,
);

const catEvents = badEvents.filter(
  (e) => e.subject === 'other' && ese.config.interiorZones.includes(e.zone),
);

const early = fromLocal(BAD_DAY, 8 * 60, TZ);
const earlyAssessment = assess({
  baseline,
  config: ese.config,
  todaysEvents: badEvents,
  health: healthySnapshot(ese, early),
  evaluatedAt: early,
});

console.log(dim(`      ${badEvents.length} events today — all of it the street and the cat`));
if (earlyAssessment.findings.length === 0) {
  console.log(`\n      ${green('Nothing to report.')}`);
  // Derived from the learned baseline rather than written in, so the prose cannot
  // drift away from what the system actually decided.
  const first = weekday.find((a) => a.key === 'first_activity');
  const usual = first === undefined ? '' : formatMinute(first.medianMinute);
  const allowed = first === undefined ? '' : formatMinute(deadlineMinute(first, 3, 30));
  console.log(
    dim(
      `      Her first activity is usually ${usual}, but she varies. Nothing is overdue\n` +
        `      until ${allowed}. Being impatient here is how you become an alert people mute.`,
    ),
  );
}
await pause(2800);

// ── 4. The bad day, now overdue ─────────────────────────────────────────────

step(4, 5, 'Asking again at 09:30');
await pause(600);

const mid = fromLocal(BAD_DAY, 9 * 60 + 30, TZ);
const midAssessment = assess({
  baseline,
  config: ese.config,
  todaysEvents: badEvents,
  health: healthySnapshot(ese, mid),
  evaluatedAt: mid,
});
const midFindings = deviations(midAssessment);

console.log(`\n      ${amber(`${midFindings.length} finding${midFindings.length === 1 ? '' : 's'}`)}`);
for (const f of midFindings) {
  console.log(dim(`        ${f.reason}`));
}
await pause(2800);

// ── 5. Escalation and the message ───────────────────────────────────────────

step(5, 5, 'Asking at 12:26');
await pause(600);

const late = fromLocal(BAD_DAY, 12 * 60 + 26, TZ);
const lateAssessment = assess({
  baseline,
  config: ese.config,
  todaysEvents: badEvents,
  health: healthySnapshot(ese, late),
  evaluatedAt: late,
});
const lateFindings = deviations(lateAssessment);

console.log(
  `\n      ${amber(`${lateFindings.length} findings`)}   severity ${bold(peakSeverity(lateAssessment) ?? 'none')}`,
);
for (const f of lateFindings) {
  console.log(dim(`        ${f.reason}`));
}

console.log(`\n      ${bold('What her daughter receives:')}\n`);
const message = fallbackNarration(lateFindings);
for (const line of wrap(message, 64)) console.log(`        ${cyan(line)}`);
console.log(
  dim(
    `\n      Offline, so this is the deterministic wording. In the deployed system\n` +
      `      Bedrock shortens it — and if the model is unavailable or says anything\n` +
      `      unsafe, this exact text is sent instead.`,
  ),
);
await pause(2500);

// ── Postscript: the two things it refuses to do ─────────────────────────────

console.log('');
rule();
console.log(`\n${bold('Two things it would have been easy to get wrong')}\n`);

console.log(`  ${bold('1. The cat.')}`);
console.log(
  dim(
    `     ${catEvents.length} interior movements today, none of them Ese. Ring classifies motion as\n` +
      `     a person, a vehicle or unidentified, and only a person counts as somebody\n` +
      `     being up. Accept the cat and the system reports a normal morning for a\n` +
      `     house nobody got out of bed in.`,
  ),
);

const blindAssessment = assess({
  baseline,
  config: ese.config,
  todaysEvents: badEvents,
  health: blindSnapshot(ese, late, 'stale'),
  evaluatedAt: late,
});

console.log(`\n  ${bold('2. A camera that stopped watching.')}`);
console.log(
  dim(
    `     Same silence, but the cameras last reported four hours ago. The system\n` +
      `     will not call that a welfare problem:`,
  ),
);
console.log(
  `\n     deviations ${bold(String(deviations(blindAssessment).length))}` +
    `   cannot-confirm ${bold(String(blindSpots(blindAssessment).length))}`,
);
const example = blindSpots(blindAssessment)[0];
if (example !== undefined) console.log(dim(`     ${example.reason}`));
console.log(
  dim(
    `\n     A flat battery and an unconscious person produce identical data. Telling\n` +
      `     them apart is the difference between a product and a liability.`,
  ),
);

console.log('');
rule();
console.log(
  `\n${dim('Everything above ran locally against the same code that is deployed.')}\n` +
    `${dim('No credentials, no network, no Ring account.')}\n`,
);

function wrap(text, width) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + word).length > width) {
      lines.push(line.trimEnd());
      line = '';
    }
    line += `${word} `;
  }
  if (line.trim() !== '') lines.push(line.trimEnd());
  return lines;
}
