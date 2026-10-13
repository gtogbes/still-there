import type { ExplainData, PauseData, ResumeData, RoutineData, StatusData } from '../types';
import { hhmm } from '../types';
import { Timeline } from './Timeline';

/**
 * Visual answers, one per tool. Each card shows the same facts the spoken reply
 * gives, plus what only a screen can show. None of them show device identifiers,
 * images or raw events — the same rule as the MCP server itself.
 */

const STATE_STYLE: Record<StatusData['state'], { label: string; tone: string; bar: string }> = {
  normal: { label: 'A normal day so far', tone: 'text-calm', bar: 'bg-calm' },
  overdue: { label: 'Something looks different today', tone: 'text-different', bar: 'bg-different' },
  cannot_see: { label: "Can't see right now", tone: 'text-unseen', bar: 'bg-unseen' },
  paused: { label: 'Monitoring paused', tone: 'text-screen-300', bar: 'bg-screen-400' },
  night: { label: 'Night-time', tone: 'text-screen-300', bar: 'bg-screen-400' },
  learning: { label: 'Still learning her routine', tone: 'text-screen-300', bar: 'bg-screen-400' },
};

function Shell({ bar, children, label }: { bar: string; children: React.ReactNode; label: string }) {
  return (
    <section
      aria-label={label}
      className="animate-rise relative overflow-hidden rounded-2xl border border-screen-600/70 bg-screen-700/60 px-6 py-5 backdrop-blur"
    >
      <div className={`absolute top-0 bottom-0 left-0 w-1.5 ${bar}`} aria-hidden />
      {children}
    </section>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function StatusCard({ data }: { data: StatusData }) {
  // "A normal day so far" before she has been seen at all would claim more than the
  // system knows. Nothing being late yet is a weaker statement, and the true one.
  const seen = data.habits.some((h) => h.state === 'done');
  const style =
    data.state === 'normal' && !seen
      ? { ...STATE_STYLE.normal, label: 'Nothing overdue yet' }
      : STATE_STYLE[data.state];
  const reliable = data.habits.find((h) => h.state === 'overdue') ?? data.habits[0];
  const ignored = data.ignored.notAPerson + data.ignored.outside;

  return (
    <Shell bar={style.bar} label="Today">
      <div className="flex items-baseline justify-between gap-4">
        <p className={`text-xs font-semibold tracking-[0.14em] uppercase ${style.tone}`}>{style.label}</p>
        {reliable && data.state === 'overdue' && (
          <p className="text-xs text-screen-300">
            Held on {reliable.presentDays} of the last {reliable.observedDays} {reliable.observedDays > 20 ? 'working' : 'comparable'} days
          </p>
        )}
      </div>

      {data.habits.length > 0 && data.state !== 'paused' && data.state !== 'learning' ? (
        <Timeline habits={data.habits} nowMinute={data.nowMinute} activityMinutes={data.activityMinutes} />
      ) : (
        <p className="mt-3 text-screen-100">{data.detail}</p>
      )}

      <div className="mt-8 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-screen-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-calm" aria-hidden /> happened
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-different" aria-hidden /> not yet
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-screen-400" aria-hidden /> not yet, still normal
        </span>
        {ignored > 0 && (
          <span className="ml-auto">
            Not counted:{' '}
            {data.ignored.notAPerson > 0 && plural(data.ignored.notAPerson, 'movement that wasn’t a person', 'movements that weren’t a person')}
            {data.ignored.notAPerson > 0 && data.ignored.outside > 0 && ' · '}
            {data.ignored.outside > 0 && plural(data.ignored.outside, 'outside', 'outside')}
          </span>
        )}
      </div>
    </Shell>
  );
}

export function RoutineCard({ data }: { data: RoutineData }) {
  const who = data.residentName ?? 'Her';
  return (
    <Shell bar="bg-alexa" label="Usual routine">
      <p className="text-xs font-semibold tracking-[0.14em] text-alexa uppercase">{who}&rsquo;s usual working day</p>
      <ol className="mt-4 space-y-3">
        {data.weekday.map((h) => (
          <li key={h.key} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-4">
            <span className="text-2xl font-semibold text-white tabular-nums">{hhmm(h.usualMinute)}</span>
            <span className="text-screen-100">{h.name}</span>
            <span className="flex items-center gap-2 text-xs text-screen-300 tabular-nums">
              <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-screen-600" aria-hidden>
                <span className="absolute inset-y-0 left-0 rounded-full bg-calm" style={{ width: `${Math.round(h.reliability * 100)}%` }} />
              </span>
              {h.presentDays}/{h.observedDays} days
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-[13px] leading-relaxed text-screen-300">
        Learned from {data.daysObserved} days, not set by anyone. Only habits that hold on more than 19 days in 20 are watched — anything less reliable would just be noise.
      </p>
    </Shell>
  );
}

export function ExplainCard({ data }: { data: ExplainData }) {
  if (!data.found) {
    return (
      <Shell bar="bg-screen-400" label="Last alert">
        <p className="text-xs font-semibold tracking-[0.14em] text-screen-300 uppercase">No recent alerts</p>
        <p className="mt-2 text-screen-100">Nothing has been sent, so there&rsquo;s nothing to explain.</p>
      </Shell>
    );
  }

  return (
    <Shell bar="bg-different" label="Why you were messaged">
      <p className="text-xs font-semibold tracking-[0.14em] text-different uppercase">
        Sent at {data.sentAtMinute === null ? '—' : hhmm(data.sentAtMinute)}
      </p>
      {data.message && <blockquote className="mt-3 border-l-2 border-screen-400 pl-4 text-lg leading-snug text-white">&ldquo;{data.message}&rdquo;</blockquote>}

      <table className="mt-5 w-full text-sm">
        <caption className="sr-only">Habits that had not happened when the message was sent</caption>
        <thead>
          <tr className="text-left text-[11px] tracking-wider text-screen-400 uppercase">
            <th className="pb-2 font-medium">Habit</th>
            <th className="pb-2 font-medium">Usually by</th>
            <th className="pb-2 font-medium">Late by</th>
            <th className="pb-2 text-right font-medium">Reliability</th>
          </tr>
        </thead>
        <tbody>
          {data.findings.map((f) => (
            <tr key={f.label} className="border-t border-screen-600/60 text-screen-100">
              <td className="py-2">{f.name}</td>
              <td className="py-2 tabular-nums">{hhmm(f.usualMinute)}</td>
              <td className="py-2 tabular-nums">{f.minutesOverdue < 60 ? `${f.minutesOverdue} min` : `${Math.round(f.minutesOverdue / 30) / 2} h`}</td>
              <td className="py-2 text-right tabular-nums">
                {f.presentDays}/{f.observedDays}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-[12px] text-screen-400">
        {data.phrasedBy === 'bedrock' ? 'Worded by Amazon Bedrock, then checked before sending.' : 'Deterministic wording.'} It only flags something once it&rsquo;s later than her own normal range.
      </p>
    </Shell>
  );
}

export function PauseCard({ data }: { data: PauseData }) {
  return (
    <Shell bar="bg-screen-400" label="Monitoring paused">
      <p className="text-xs font-semibold tracking-[0.14em] text-screen-300 uppercase">Paused for {data.days} {data.days === 1 ? 'day' : 'days'}</p>
      <p className="mt-2 text-3xl font-semibold text-white">Until {formatDate(data.untilDateKey)}</p>
      <p className="mt-2 text-screen-300">Reason: {data.reason}. Activity is still recorded, so the routine won&rsquo;t be forgotten.</p>
    </Shell>
  );
}

export function ResumeCard({ data }: { data: ResumeData }) {
  return (
    <Shell bar="bg-calm" label="Monitoring resumed">
      <p className="text-xs font-semibold tracking-[0.14em] text-calm uppercase">{data.wasPaused ? 'Watching again' : 'Already watching'}</p>
      <p className="mt-2 text-screen-100">{data.wasPaused ? 'Monitoring is back on from now.' : 'Monitoring was not paused.'}</p>
    </Shell>
  );
}

function formatDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}
