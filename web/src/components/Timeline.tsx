import type { HabitToday } from '../types';
import { hhmm } from '../types';

/**
 * The day, drawn: one row per habit, with a NOW line running through them.
 *
 * Rows rather than labelled dots on a single axis, because real routines cluster —
 * four of Jasmine's habits fall within forty minutes of each other — and labels above
 * one axis collide. A row each means no label can overlap another.
 *
 * Each row shows the habit's normal window (usual time to the latest it has been on
 * an ordinary day), a green dot when it happened, or a hollow amber ring at its usual
 * time when it hasn't. Absences are drawn as absences.
 *
 * The NOW line is drawn as a slice in every row; rows have no vertical gap, so the
 * slices read as one continuous line without any absolute-positioned overlay.
 */

function windowFor(habits: HabitToday[], nowMinute: number): { start: number; end: number } {
  const usual = habits.map((h) => h.usualMinute);
  const late = habits.map((h) => Math.max(h.deadlineMinute, h.happenedAtMinute ?? 0));
  const start = Math.max(Math.floor((Math.min(...usual, nowMinute) - 45) / 60) * 60, 0);
  const end = Math.min(Math.ceil((Math.max(...late, nowMinute) + 30) / 60) * 60, 24 * 60);
  return { start, end: Math.max(end, start + 180) };
}

const STATE_TEXT: Record<HabitToday['state'], string> = {
  done: 'text-screen-100',
  overdue: 'text-different',
  waiting: 'text-screen-300',
  cannot_see: 'text-unseen',
};

function statusText(h: HabitToday): string {
  if (h.state === 'done' && h.happenedAtMinute !== null) return `at ${hhmm(h.happenedAtMinute)}`;
  if (h.state === 'overdue') return `not yet · usually ${hhmm(h.usualMinute)}`;
  if (h.state === 'cannot_see') return "can't see";
  return `usually ${hhmm(h.usualMinute)}`;
}

const GRID = 'grid grid-cols-[8.5rem_1fr_11rem] items-center gap-x-5';

export function Timeline({
  habits,
  nowMinute,
  activityMinutes,
}: {
  habits: HabitToday[];
  nowMinute: number;
  activityMinutes: number[];
}) {
  if (habits.length === 0) return null;
  const { start, end } = windowFor(habits, nowMinute);
  const pct = (m: number) => ((Math.min(Math.max(m, start), end) - start) / (end - start)) * 100;
  const ticks: number[] = [];
  for (let m = start; m <= end; m += 60) ticks.push(m);
  const nowVisible = nowMinute >= start && nowMinute <= end;

  const NowSlice = () =>
    nowVisible ? (
      <div className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-alexa transition-[left] duration-500" style={{ left: `${pct(nowMinute)}%` }} aria-hidden />
    ) : null;

  return (
    <figure className="mt-4" aria-label="Today's usual habits and whether each has happened">
      {habits.map((h) => {
        const done = h.state === 'done' && h.happenedAtMinute !== null;
        const dotAt = done ? (h.happenedAtMinute as number) : h.usualMinute;
        const from = pct(h.usualMinute);
        const to = pct(h.deadlineMinute);
        return (
          <div key={h.key} className={GRID}>
            <span className={`text-[15px] font-medium ${STATE_TEXT[h.state]}`}>{h.name}</span>

            <div className="relative h-10">
              <div className="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-screen-600/70" aria-hidden />
              <div
                className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full ${h.state === 'overdue' ? 'bg-different/45' : 'bg-screen-600'}`}
                style={{ left: `${from}%`, width: `${Math.max(to - from, 0.8)}%` }}
                aria-hidden
              />
              <NowSlice />
              <div
                className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-500 ${
                  h.state === 'done'
                    ? 'bg-calm ring-4 ring-calm/20'
                    : h.state === 'overdue'
                      ? 'animate-pulse-soft border-[3px] border-different bg-screen-800'
                      : h.state === 'cannot_see'
                        ? 'border-2 border-dashed border-unseen bg-screen-800'
                        : 'border-2 border-screen-400 bg-screen-800'
                }`}
                style={{ left: `${pct(dotAt)}%` }}
                aria-hidden
              />
            </div>

            <span className={`text-right text-[13px] tabular-nums ${STATE_TEXT[h.state]}`}>{statusText(h)}</span>
          </div>
        );
      })}

      {/* Axis, with moments a person was seen indoors as small ticks above it. */}
      <div className={GRID}>
        <span />
        <div className="relative h-12">
          <div className="absolute top-0 h-3 w-full" aria-hidden>
            {nowVisible && <div className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-alexa transition-[left] duration-500" style={{ left: `${pct(nowMinute)}%` }} />}
            {activityMinutes
              .filter((m) => m >= start && m <= Math.min(nowMinute, end))
              .map((m, i) => (
                <span key={`${m}-${i}`} className="absolute top-0 h-2 w-[2px] -translate-x-1/2 rounded bg-calm/70" style={{ left: `${pct(m)}%` }} />
              ))}
          </div>
          {/* Drop hour labels the NOW pill would sit on top of (~7% of the axis either side). */}
          {ticks.filter((m) => !nowVisible || Math.abs(pct(m) - pct(nowMinute)) > 10).map((m) => (
            <span key={m} className="absolute top-4 -translate-x-1/2 text-[11px] text-screen-400 tabular-nums" style={{ left: `${pct(m)}%` }}>
              {hhmm(m)}
            </span>
          ))}
          {nowVisible && (
            <span
              className="absolute top-[1.6rem] -translate-x-1/2 rounded-full bg-alexa px-2 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap text-screen-900 transition-[left] duration-500"
              style={{ left: `${pct(nowMinute)}%` }}
            >
              NOW {hhmm(nowMinute)}
            </span>
          )}
        </div>
        <span />
      </div>
    </figure>
  );
}
