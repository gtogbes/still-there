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
  return <p className="font-mono text-[11px] text-screen-400">{parts.join('  ·  ')}</p>;
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
    <div className="rounded-[34px] bg-[#1b1c1f] p-6 shadow-[0_30px_60px_-20px_rgba(43,36,24,0.45)]">
      <div className="relative flex min-h-[760px] flex-col overflow-hidden rounded-[18px] bg-gradient-to-br from-screen-900 to-screen-800 px-8 pt-6 pb-5">
        {/* Status bar */}
        <div className="flex items-center justify-between text-[15px] text-screen-300">
          <span className="font-medium tabular-nums">
            {props.dayLabel} · {hhmm(props.minute)}
          </span>
          <span className="flex items-center gap-2 rounded-full border border-screen-600 bg-screen-700/70 px-3 py-1 text-[12px] text-screen-100">
            <span className="h-2 w-2 rounded-full bg-different" aria-hidden />
            Demo clock · compressed time
          </span>
        </div>

        {/* What was said */}
        <p className="mt-6 min-h-[1.75rem] text-lg text-screen-400 italic" aria-live="polite">
          {props.phase === 'listening' ? (props.interim || 'Listening…') : props.utterance ? `“${props.utterance}”` : ''}
        </p>

        {/* The answer */}
        <div aria-live="polite" aria-atomic="true">
          <h2 className={`mt-2 leading-tight font-semibold text-white ${props.headline.length > 56 ? 'text-[25px]' : 'text-[30px]'}`}>{props.headline}</h2>
          {props.detail && <p className="mt-2 max-w-3xl text-lg leading-snug text-screen-300">{props.detail}</p>}
        </div>

        <div className="mt-6 flex-1">{props.card && <CardView card={props.card} />}</div>

        {/* Suggestions */}
        <div className="mt-6 flex flex-wrap gap-2.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => props.onAsk(s)}
              className="rounded-full border border-screen-600 bg-screen-700/70 px-4 py-2 text-sm font-medium text-screen-100 transition hover:border-screen-400 hover:bg-screen-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alexa disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>

        {/* Ask */}
        <form
          className="mt-4 flex items-center gap-3"
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
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-alexa ${
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
            className="h-12 flex-1 rounded-full border border-screen-600 bg-screen-900/60 px-5 text-screen-100 placeholder:text-screen-400 focus:border-alexa focus:outline-none"
          />
        </form>

        <div className="mt-3 min-h-[1rem]">{props.trace && <TraceLine trace={props.trace} />}</div>

        {/* Alexa light bar */}
        <div className="pointer-events-none absolute right-0 bottom-0 left-0 flex h-2 justify-center" aria-hidden>
          <div
            className={`h-full w-full origin-center bg-gradient-to-r from-transparent via-alexa to-transparent ${
              props.phase === 'idle' ? 'opacity-0' : props.phase === 'speaking' ? 'opacity-90' : 'animate-ring'
            } transition-opacity duration-300`}
          />
        </div>
      </div>
      <div className="mx-auto mt-4 h-2.5 w-72 rounded-full bg-[#2c2d31]" aria-hidden />
    </div>
  );
}
