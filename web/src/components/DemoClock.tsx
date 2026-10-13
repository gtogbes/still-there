import { useEffect, useRef } from 'react';
import { hhmm } from '../types';

/**
 * The demo clock, visible and labelled. Compressed time is the one liberty the demo
 * takes, so it is shown rather than hidden: the events are real stored rows, and this
 * only chooses which moment the system is asked about.
 */

export const CLOCK_START = 6 * 60;
export const CLOCK_END = 13 * 60;
const PRESETS = [
  { label: '08:00', minute: 8 * 60 },
  { label: '09:30', minute: 9 * 60 + 30 },
  { label: '11:00', minute: 11 * 60 },
  { label: '12:30', minute: 12 * 60 + 30 },
];

export function DemoClock({
  minute,
  playing,
  onChange,
  onPlayingChange,
}: {
  minute: number;
  playing: boolean;
  onChange: (minute: number) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const latest = useRef(minute);
  latest.current = minute;

  // Five minutes of house time every 250 ms: the whole morning in about a minute.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const next = latest.current + 5;
      if (next >= CLOCK_END) {
        onChange(CLOCK_END);
        onPlayingChange(false);
      } else {
        onChange(next);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [playing, onChange, onPlayingChange]);

  return (
    <section aria-label="Demo clock" className="w-[330px] rounded-2xl border border-room-200 bg-white/75 px-5 py-4 shadow-sm backdrop-blur">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onPlayingChange(!playing)}
          aria-label={playing ? 'Pause the demo clock' : 'Play the morning'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-room-800 text-white transition hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-800"
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M7 4.5v15l12-7.5z" />
            </svg>
          )}
        </button>
        <label htmlFor="clock" className="flex flex-1 items-baseline justify-between">
          <span className="text-sm font-semibold text-room-800">Demo clock</span>
          <span className="text-2xl font-semibold text-room-800 tabular-nums">{hhmm(minute)}</span>
        </label>
      </div>

      <input
        id="clock"
        className="clock mt-3"
        type="range"
        min={CLOCK_START}
        max={CLOCK_END}
        step={5}
        value={minute}
        aria-valuetext={hhmm(minute)}
        onChange={(e) => {
          onPlayingChange(false);
          onChange(Number(e.target.value));
        }}
      />

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              onPlayingChange(false);
              onChange(p.minute);
            }}
            className={`rounded-full py-1.5 text-sm font-medium tabular-nums transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-800 ${
              minute === p.minute ? 'bg-room-800 text-white' : 'bg-room-100 text-room-800 hover:bg-room-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-[11.5px] leading-snug text-room-600">
        Compressed time, labelled on purpose. Jasmine&rsquo;s events are real rows with real timestamps; the clock only chooses the moment StillThere is asked about.
      </p>
    </section>
  );
}
