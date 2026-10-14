import { useState } from 'react';
import type { Card, Trace } from '../types';
import { hhmm } from '../types';
import { ExplainCard, PauseCard, ResumeCard, RoutineCard, StatusCard } from './Cards';

/**
 * The Echo Show. A stand-in for the real device's screen, honestly labelled as such
 * in the page header, rendering what the live MCP server returned.
 */

export const SUGGESTIONS = [
  'Is Jasmine up yet?',
  'Why did you message me?',
  "What's her normal day like?",
  "She's away next week",
  "She's back",
];

export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

function CardView({ card }: { card: Card }) {
  switch (card.kind) {
    case 'status':
      return <StatusCard data={card} />;
    case 'routine':
      return <RoutineCard data={card} />;
    case 'explanation':
      return <ExplainCard data={card} />;
    case 'paused':
      return <PauseCard data={card} />;
    case 'resumed':
      return <ResumeCard data={card} />;
  }
}

function TraceLine({ trace }: { trace: Trace }) {
  const parts = [
    `mcp · ${trace.tool ?? 'no tool'}`,
    trace.router === 'bedrock' ? `routed by Bedrock (${trace.model ?? 'model'})` : 'keyword router (fallback)',
    `${trace.timings.totalMs} ms`,
    `protocol ${trace.protocolVersion}`,
    `${trace.toolsDiscovered} tools discovered`,
  ];
  return (
    <p className="truncate font-mono text-[10px] text-screen-400 sm:text-[11px] sm:whitespace-normal">
      {parts.join('  ·  ')}
    </p>
  );
}

export function EchoShow(props: {
  dayLabel: string;
  minute: number;
  utterance: string;
  headline: string;
  detail: string;
  card: Card | null;
  trace: Trace | null;
  phase: Phase;
  interim: string;
  voiceSupported: boolean;
  onMic: () => void;
  onAsk: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const busy = props.phase === 'thinking';

  return (
    <div className="screen-glow relative">
      <div className="shell rounded-[22px] p-2.5 sm:rounded-[34px] sm:p-6">
        <div className="glass relative flex min-h-[520px] flex-col overflow-hidden rounded-[14px] bg-gradient-to-br from-screen-900 to-screen-800 px-4 pt-4 pb-4 sm:min-h-[760px] sm:rounded-[18px] sm:px-8 sm:pt-6 sm:pb-5">
        {/* Status bar */}
        <div className="flex items-center justify-between gap-2 text-[13px] text-screen-300 sm:text-[15px]">
          <span className="truncate font-medium tabular-nums">
            {props.dayLabel} · {hhmm(props.minute)}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-screen-600 bg-screen-700/70 px-2.5 py-1 text-[11px] whitespace-nowrap text-screen-100 sm:gap-2 sm:px-3 sm:text-[12px]">
            <span className="h-1.5 w-1.5 rounded-full bg-different sm:h-2 sm:w-2" aria-hidden />
            Demo clock<span className="hidden sm:inline"> · compressed time</span>
          </span>
        </div>

        {/* What was said */}
        <p className="mt-4 min-h-[1.5rem] text-[15px] text-screen-400 italic sm:mt-6 sm:min-h-[1.75rem] sm:text-lg" aria-live="polite">
          {props.phase === 'listening' ? (props.interim || 'Listening…') : props.utterance ? `“${props.utterance}”` : ''}
        </p>

        {/* The answer */}
        <div aria-live="polite" aria-atomic="true">
          <h2
            className={`mt-1.5 leading-tight font-semibold text-white text-balance sm:mt-2 ${
              props.headline.length > 56 ? 'text-[21px] sm:text-[25px]' : 'text-[23px] sm:text-[30px]'
            }`}
          >
            {props.headline}
          </h2>
          {props.detail && (
            <p className="mt-1.5 max-w-3xl text-[15px] leading-snug text-screen-300 sm:mt-2 sm:text-lg">
              {props.detail}
            </p>
          )}
        </div>

        <div className="mt-4 flex-1 sm:mt-6">{props.card && <CardView card={props.card} />}</div>

        {/* Suggestions */}
        <div className="chip-row -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mt-6 sm:flex-wrap sm:gap-2.5 sm:overflow-visible sm:px-0">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => props.onAsk(s)}
              className="shrink-0 rounded-full border border-screen-600 bg-screen-700/70 px-3.5 py-2 text-[13px] font-medium whitespace-nowrap text-screen-100 transition active:scale-[0.97] hover:border-screen-400 hover:bg-screen-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alexa disabled:opacity-50 sm:px-4 sm:text-sm"
            >
              {s}
            </button>
          ))}
        </div>

        {/* Ask */}
        <form
          className="mt-3 flex items-center gap-2 sm:mt-4 sm:gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (text === '' || busy) return;
            props.onAsk(text);
            setDraft('');
          }}
        >
          {props.voiceSupported && (
            <button
              type="button"
              onClick={props.onMic}
              aria-pressed={props.phase === 'listening'}
              aria-label={props.phase === 'listening' ? 'Stop listening' : 'Ask by voice'}
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alexa sm:h-12 sm:w-12 ${
                props.phase === 'listening' ? 'bg-alexa text-screen-900' : 'bg-screen-600 text-white hover:bg-screen-400'
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
                <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-2.07A7 7 0 0 0 19 12h-2Z" />
              </svg>
            </button>
          )}
          <label htmlFor="ask" className="sr-only">
            Ask StillThere
          </label>
          <input
            id="ask"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={300}
            placeholder={props.voiceSupported ? 'Or type: is Jasmine up yet?' : 'Ask: is Jasmine up yet?'}
            className="h-11 min-w-0 flex-1 rounded-full border border-screen-600 bg-screen-900/60 px-4 text-[15px] text-screen-100 placeholder:text-screen-400 focus:border-alexa focus:outline-none sm:h-12 sm:px-5"
          />
        </form>

        <div className="mt-2.5 min-h-[0.9rem] sm:mt-3 sm:min-h-[1rem]">
          {props.trace && <TraceLine trace={props.trace} />}
        </div>

        {/* Alexa light bar */}
        <div className="pointer-events-none absolute right-0 bottom-0 left-0 flex h-2 justify-center" aria-hidden>
          <div
            className={`h-full w-full origin-center bg-gradient-to-r from-transparent via-alexa to-transparent ${
              props.phase === 'idle' ? 'opacity-0' : props.phase === 'speaking' ? 'opacity-90' : 'animate-ring'
            } transition-opacity duration-300`}
          />
        </div>
        </div>
      </div>
      <div
        className="mx-auto mt-3 h-2 w-40 rounded-full bg-[#2c2d31] shadow-[0_6px_14px_-6px_rgba(50,42,30,0.5)] sm:mt-4 sm:h-2.5 sm:w-72"
        aria-hidden
      />
    </div>
  );
}
