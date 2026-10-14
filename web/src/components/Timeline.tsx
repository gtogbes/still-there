import type { HabitToday } from '../types';
import { hhmm } from '../types';

/**
 * The day, drawn: one row per habit, with a NOW line running through them.
 *
 * Rows rather than labelled dots on a single axis, because real routines cluster.
 * Four of Jasmine's habits fall within forty minutes of each other, and labels above
 * one axis collide. A row each means no label can overlap another.
 *
 * Each row shows the habit's normal window (usual time to the latest it has been on
 * an ordinary day), a green dot when it happened, or a hollow amber ring at its usual
 * time when it hasn't. Absences are drawn as absences.
 *
 * Two layouts. Wide screens put the name, the track and the status on one line, and
 * the NOW line is a slice drawn inside each row, so with no vertical gaps the slices
 * read as one continuous line. A phone has no room for three columns, so the track
 * takes the full width on its own line and the NOW line becomes a single overlay
 * across the rows, which only works because every track then shares one geometry.
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

/** Name and status share a line on mobile; all three share one on desktop. */
const GRID =
  'grid grid-cols-[1fr_auto] items-center gap-x-3 sm:grid-cols-[8.5rem_1fr_11rem] sm:gap-x-5';

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
  const nowLeft = `${pct(nowMinute)}%`;

  return (
    <figure className="mt-4" aria-label="Today's usual habits and whether each has happened">
      <div className="relative">
        {nowVisible && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-alexa/15 transition-[left] duration-500 sm:hidden"
            style={{ left: nowLeft }}
            aria-hidden
          />
        )}
        {habits.map((h) => {
          const done = h.state === 'done' && h.happenedAtMinute !== null;
          const dotAt = done ? (h.happenedAtMinute as number) : h.usualMinute;
          const from = pct(h.usualMinute);
          const to = pct(h.deadlineMinute);
          return (
            <div key={h.key} className={`${GRID} py-1.5 sm:py-0`}>
              <span className={`truncate text-[14px] font-medium sm:text-[15px] ${STATE_TEXT[h.state]}`}>
                {h.name}
              </span>

              {/* Status sits after the name on mobile, after the track on desktop. */}
              <span
                className={`order-2 text-right text-[12px] tabular-nums sm:order-3 sm:text-[13px] ${STATE_TEXT[h.state]}`}
              >
                {statusText(h)}
              </span>

              <div className="relative order-3 col-span-2 h-7 sm:order-2 sm:col-span-1 sm:h-10">
                <div
                  className="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-screen-600/70"
                  aria-hidden
                />
                <div
                  className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full ${
                    h.state === 'overdue' ? 'bg-different/45' : 'bg-screen-600'
                  }`}
                  style={{ left: `${from}%`, width: `${Math.max(to - from, 0.8)}%` }}
                  aria-hidden
                />
                {/*
                  Drawn inside the track, not as an overlay across the figure. On a
                  phone the name and status share a line above each track, and an
                  overlay tall enough to look continuous struck through that text.
                */}
                {nowVisible && (
                  <div
                    className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-alexa transition-[left] duration-500"
                    style={{ left: nowLeft }}
                    aria-hidden
                  />
                )}
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
            </div>
          );
        })}
      </div>

      {/* Axis, with moments a person was seen indoors as small ticks above it. */}
      <div className={GRID}>
        <span className="hidden sm:block" />
        <div className="relative col-span-2 h-11 sm:col-span-1 sm:h-12">
          <div className="absolute top-0 h-3 w-full" aria-hidden>
            {nowVisible && (
              <div
                className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-alexa transition-[left] duration-500"
                style={{ left: nowLeft }}
              />
            )}
            {activityMinutes
              .filter((m) => m >= start && m <= Math.min(nowMinute, end))
              .map((m, i) => (
                <span
                  key={`${m}-${i}`}
                  className="absolute top-0 h-2 w-[2px] -translate-x-1/2 rounded bg-calm/70"
                  style={{ left: `${pct(m)}%` }}
                />
              ))}
          </div>
          {/* Hour labels the NOW pill would sit on top of are dropped. Fewer of them
              on a phone, where the axis is narrower in real terms. */}
          {ticks
            .filter((m) => !nowVisible || Math.abs(pct(m) - pct(nowMinute)) > 10)
            .map((m, i) => {
              // Centring a label on the first or last tick pushes half of it off
              // the edge, so those two are anchored instead.
              const at = pct(m);
              const edge = at < 4 ? 'start' : at > 96 ? 'end' : 'middle';
              return (
                <span
                  key={m}
                  className={`absolute top-4 text-[10px] text-screen-400 tabular-nums sm:text-[11px] ${
                    edge === 'middle' ? '-translate-x-1/2' : edge === 'end' ? '-translate-x-full' : ''
                  } ${i % 2 === 1 ? 'hidden sm:inline' : ''}`}
                  style={{ left: `${at}%` }}
                >
                  {hhmm(m)}
                </span>
              );
            })}
          {nowVisible && (
            <span
              className="absolute top-[1.6rem] -translate-x-1/2 rounded-full bg-alexa px-2 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap text-screen-900 shadow-[0_0_12px_rgba(25,199,255,0.45)] transition-[left] duration-500"
              style={{ left: nowLeft }}
            >
              NOW {hhmm(nowMinute)}
            </span>
          )}
        </div>
        <span className="hidden sm:block" />
      </div>
    </figure>
  );
}
