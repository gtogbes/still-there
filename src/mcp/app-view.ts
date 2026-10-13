import type {
  ExplainData,
  HabitToday,
  PauseData,
  ResumeData,
  RoutineData,
  StatusData,
} from './tools.js';

/**
 * The MCP App view, as a pure function: structuredContent in, HTML out.
 *
 * Under the MCP Apps extension the server ships its own UI as a `ui://` resource,
 * and the host — Alexa+ on an Echo Show, Claude, or our own simulated device —
 * renders it in a sandboxed iframe and hands it each tool result. This is the
 * part that turns a result into something to look at.
 *
 * No DOM here, so it is tested in Node like everything else. The browser glue in
 * mcp-app/main.ts only connects to the host and assigns innerHTML.
 *
 * Everything interpolated is escaped. The data is ours, but a resident name or a
 * pause reason ends up in here, and a pause reason is typed by a family member.
 */

type Card = StatusData | RoutineData | ExplainData | PauseData | ResumeData;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function hhmm(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function isCard(value: unknown): value is Card {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string'
  );
}

// ── Status: the day, drawn ─────────────────────────────────────────────────

const STATE_LABEL: Record<StatusData['state'], string> = {
  normal: 'A normal day so far',
  overdue: 'Something looks different today',
  cannot_see: "Can't see right now",
  paused: 'Monitoring paused',
  night: 'Night-time',
  learning: 'Still learning her routine',
};

function habitStatus(h: HabitToday): string {
  if (h.state === 'done' && h.happenedAtMinute !== null) return `at ${hhmm(h.happenedAtMinute)}`;
  if (h.state === 'overdue') return `not yet · usually ${hhmm(h.usualMinute)}`;
  if (h.state === 'cannot_see') return "can't see";
  return `usually ${hhmm(h.usualMinute)}`;
}

function timeline(data: StatusData): string {
  const usual = data.habits.map((h) => h.usualMinute);
  const late = data.habits.map((h) => Math.max(h.deadlineMinute, h.happenedAtMinute ?? 0));
  const start = Math.max(Math.floor((Math.min(...usual, data.nowMinute) - 45) / 60) * 60, 0);
  const end = Math.max(
    Math.min(Math.ceil((Math.max(...late, data.nowMinute) + 30) / 60) * 60, 1440),
    start + 180,
  );
  const pct = (m: number) =>
    (((Math.min(Math.max(m, start), end) - start) / (end - start)) * 100).toFixed(2);
  const now = pct(data.nowMinute);

  const rows = data.habits
    .map((h) => {
      const at = h.state === 'done' && h.happenedAtMinute !== null ? h.happenedAtMinute : h.usualMinute;
      const width = Math.max(Number(pct(h.deadlineMinute)) - Number(pct(h.usualMinute)), 0.8).toFixed(2);
      return `<li class="row ${h.state}">
        <span class="name">${escapeHtml(h.name)}</span>
        <span class="track" aria-hidden="true">
          <span class="band" style="left:${pct(h.usualMinute)}%;width:${width}%"></span>
          <span class="now" style="left:${now}%"></span>
          <span class="dot" style="left:${pct(at)}%"></span>
        </span>
        <span class="when">${escapeHtml(habitStatus(h))}</span>
      </li>`;
    })
    .join('');

  const ticks: string[] = [];
  for (let m = start; m <= end; m += 60) {
    if (Math.abs(Number(pct(m)) - Number(now)) > 10) {
      ticks.push(`<span class="tick" style="left:${pct(m)}%">${hhmm(m)}</span>`);
    }
  }

  return `<ol class="timeline" aria-label="Today's usual habits and whether each has happened">${rows}</ol>
    <div class="axis" aria-hidden="true"><span class="track">${ticks.join('')}<span class="nowpill" style="left:${now}%">NOW ${hhmm(data.nowMinute)}</span></span></div>`;
}

function statusCard(data: StatusData): string {
  const seen = data.habits.some((h) => h.state === 'done');
  const label = data.state === 'normal' && !seen ? 'Nothing overdue yet' : STATE_LABEL[data.state];
  const drawable = data.habits.length > 0 && data.state !== 'paused' && data.state !== 'learning';
  const ignored = data.ignored.notAPerson + data.ignored.outside;
  return `<section class="card tone-${data.state}" aria-label="Today">
    <p class="eyebrow">${escapeHtml(label)}</p>
    <h1>${escapeHtml(data.headline)}</h1>
    <p class="detail">${escapeHtml(data.detail)}</p>
    ${drawable ? timeline(data) : ''}
    ${
      ignored > 0
        ? `<p class="foot">Not counted: ${data.ignored.notAPerson} movement${data.ignored.notAPerson === 1 ? '' : 's'} that ${data.ignored.notAPerson === 1 ? "wasn't" : "weren't"} a person · ${data.ignored.outside} outside</p>`
        : ''
    }
  </section>`;
}

// ── The other answers ──────────────────────────────────────────────────────

function routineCard(data: RoutineData): string {
  const who = data.residentName === null ? 'Her' : `${data.residentName}'s`;
  const items = data.weekday
    .map(
      (h) => `<li><span class="big">${hhmm(h.usualMinute)}</span><span>${escapeHtml(h.name)}</span>
        <span class="held"><span class="meter" aria-hidden="true"><span style="width:${Math.round(h.reliability * 100)}%"></span></span>${h.presentDays}/${h.observedDays} days</span></li>`,
    )
    .join('');
  return `<section class="card tone-routine" aria-label="Usual routine">
    <p class="eyebrow">${escapeHtml(who)} usual working day</p>
    <ol class="routine">${items}</ol>
    <p class="foot">Learned from ${data.daysObserved} days, not set by anyone. Only habits that hold on more than 19 days in 20 are watched.</p>
  </section>`;
}

function explainCard(data: ExplainData): string {
  if (!data.found) {
    return `<section class="card tone-normal" aria-label="Last alert"><p class="eyebrow">No recent alerts</p>
      <h1>Nothing has been sent, so there's nothing to explain.</h1></section>`;
  }
  const rows = data.findings
    .map(
      (f) => `<tr><td>${escapeHtml(f.name)}</td><td>${hhmm(f.usualMinute)}</td>
        <td>${f.minutesOverdue < 60 ? `${f.minutesOverdue} min` : `${Math.round(f.minutesOverdue / 30) / 2} h`}</td>
        <td class="r">${f.presentDays}/${f.observedDays}</td></tr>`,
    )
    .join('');
  return `<section class="card tone-overdue" aria-label="Why you were messaged">
    <p class="eyebrow">Sent at ${data.sentAtMinute === null ? '—' : hhmm(data.sentAtMinute)}</p>
    ${data.message === null ? '' : `<blockquote>“${escapeHtml(data.message)}”</blockquote>`}
    <table><caption>Habits that had not happened when the message was sent</caption>
      <thead><tr><th>Habit</th><th>Usually by</th><th>Late by</th><th class="r">Held on</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <p class="foot">${data.phrasedBy === 'bedrock' ? 'Worded by Amazon Bedrock, then checked before sending.' : 'Deterministic wording.'}</p>
  </section>`;
}

function pauseCard(data: PauseData): string {
  return `<section class="card tone-paused" aria-label="Monitoring paused">
    <p class="eyebrow">Paused for ${data.days} day${data.days === 1 ? '' : 's'}</p>
    <h1>Until ${escapeHtml(data.untilDateKey)}</h1>
    <p class="detail">Reason: ${escapeHtml(data.reason)}. Activity is still recorded, so the routine won't be forgotten.</p>
  </section>`;
}

function resumeCard(data: ResumeData): string {
  return `<section class="card tone-normal" aria-label="Monitoring resumed">
    <p class="eyebrow">${data.wasPaused ? 'Watching again' : 'Already watching'}</p>
    <h1>${data.wasPaused ? 'Monitoring is back on from now.' : 'Monitoring was not paused.'}</h1>
  </section>`;
}

/**
 * The view for one tool result. Falls back to the plain text the tool returned
 * when the structured content is missing or of a kind this view doesn't know —
 * a newer server talking to an older cached view should degrade, not go blank.
 */
export function renderView(structured: unknown, fallbackText = ''): string {
  if (!isCard(structured)) {
    return `<section class="card"><p class="detail">${escapeHtml(fallbackText || 'No answer to show.')}</p></section>`;
  }
  switch (structured.kind) {
    case 'status':
      return statusCard(structured);
    case 'routine':
      return routineCard(structured);
    case 'explanation':
      return explainCard(structured);
    case 'paused':
      return pauseCard(structured);
    case 'resumed':
      return resumeCard(structured);
    default:
      return `<section class="card"><p class="detail">${escapeHtml(fallbackText)}</p></section>`;
  }
}
