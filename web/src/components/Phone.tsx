import type { Severity } from '../types';
import { hhmm } from '../types';

/**
 * The family member's phone. Notifications are the real stored messages — produced by
 * the deployed assessment and worded by Bedrock — shown once the demo clock reaches
 * the moment they were sent.
 */

export interface PhoneNotification {
  sentAtMinute: number;
  message: string;
  severity: Severity | null;
}

const TITLE: Record<Severity, string> = {
  low: 'A small change today',
  medium: 'Something looks different today',
  high: 'Worth a call today',
};

export function Phone({
  minute,
  dateLabel,
  notifications,
}: {
  minute: number;
  dateLabel: string;
  notifications: PhoneNotification[];
}) {
  const visible = notifications
    .filter((n) => n.sentAtMinute <= minute)
    .sort((a, b) => b.sentAtMinute - a.sentAtMinute);

  return (
    <div className="w-[330px] rounded-[46px] bg-[#121216] p-3 shadow-[0_30px_60px_-20px_rgba(43,36,24,0.5)]">
      <div className="relative flex h-[560px] flex-col overflow-hidden rounded-[36px] bg-gradient-to-b from-[#3a2f4f] via-[#2a2440] to-[#1c1a2e] px-4 pt-3">
        <div className="mx-auto h-7 w-28 rounded-full bg-black" aria-hidden />
        {/* The lock-screen clock gives way once messages stack up, so all of them fit. */}
        <p
          className={`text-center leading-none font-light text-white tabular-nums transition-all duration-500 ${
            visible.length >= 3 ? 'mt-3 text-[40px]' : 'mt-6 text-[56px]'
          }`}
        >
          {hhmm(minute)}
        </p>
        <p className="mt-2 text-center text-sm text-[#d8cfea]">{dateLabel}</p>

        <ul className="mt-5 min-h-0 flex-1 space-y-2 overflow-hidden" aria-label="Notifications" aria-live="polite">
          {visible.length === 0 && <li className="mt-6 text-center text-xs text-[#b8aed0]">No notifications</li>}
          {visible.map((n, i) => (
            <li
              key={n.sentAtMinute}
              className={`animate-slide-down rounded-2xl bg-white/90 p-3.5 shadow-lg ${i > 0 ? 'opacity-70' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-md bg-[#4b3f8f] text-[10px] font-bold text-white" aria-hidden>
                  S
                </span>
                <span className="text-[11px] font-semibold tracking-wide text-[#3a3550]">STILLTHERE</span>
                <span className="ml-auto text-[11px] text-[#7a7590] tabular-nums">{hhmm(n.sentAtMinute)}</span>
              </div>
              <p className="mt-1.5 text-[13.5px] font-semibold text-[#1d1a2b]">{n.severity ? TITLE[n.severity] : 'StillThere'}</p>
              <p className={`mt-0.5 text-[13px] leading-snug text-[#3d3852] ${i > 0 ? 'line-clamp-1' : ''}`}>{n.message}</p>
            </li>
          ))}
        </ul>

        <div className="mt-2 mb-2 flex shrink-0 justify-center" aria-hidden>
          <div className="h-1.5 w-32 rounded-full bg-white/60" />
        </div>
      </div>
    </div>
  );
}
