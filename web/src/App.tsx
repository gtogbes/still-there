import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessGate, readStoredCode, storeCode } from './components/AccessGate';
import { DemoClock } from './components/DemoClock';
import { EchoShow, type Phase } from './components/EchoShow';
import { Phone } from './components/Phone';
import { useAmbient } from './hooks/useAmbient';
import { AccessDenied, ask } from './lib/api';
import { speak, stopSpeaking, useListening } from './lib/speech';
import type { Card, Trace, Turn } from './types';

interface Answer {
  utterance: string;
  speech: string;
  card: Card | null;
  trace: Trace | null;
  /** The demo minute the answer was for. Moving the clock returns to the ambient view. */
  minute: number;
}

function splitSpeech(speech: string): { headline: string; detail: string } {
  const match = /^(.+?[.!?])\s+(.*)$/s.exec(speech.trim());
  return match ? { headline: match[1] ?? speech, detail: match[2] ?? '' } : { headline: speech, detail: '' };
}

export function App() {
  const [accessCode, setAccessCode] = useState(readStoredCode);
  const [rejected, setRejected] = useState(false);
  const [minute, setMinute] = useState(8 * 60);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const history = useRef<Turn[]>([]);

  const denied = useCallback(() => {
    storeCode('');
    setAccessCode('');
    setRejected(true);
  }, []);

  const ambient = useAmbient(minute, accessCode, denied);

  const today = useMemo(() => new Date(), []);
  const dayLabel = today.toLocaleDateString('en-GB', { weekday: 'long' });
  const dateLabel = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const onAsk = useCallback(
    async (utterance: string) => {
      if (accessCode === '') return;
      setPlaying(false);
      stopSpeaking();
      setPhase('thinking');
      setAnswer({ utterance, speech: '', card: null, trace: null, minute });
      try {
        const reply = await ask({ utterance, demoMinute: minute, history: history.current, accessCode });
        history.current = [...history.current, { role: 'user' as const, text: utterance }, { role: 'assistant' as const, text: reply.speech }].slice(-6);
        setAnswer({ utterance, speech: reply.speech, card: reply.card, trace: reply.trace, minute });
        setPhase('speaking');
        speak(reply.speech, voiceOn);
        window.setTimeout(() => setPhase((p) => (p === 'speaking' ? 'idle' : p)), 2600);
      } catch (err) {
        if (err instanceof AccessDenied) denied();
        setAnswer({ utterance, speech: "Sorry, I can't reach StillThere at the moment.", card: null, trace: null, minute });
        setPhase('idle');
      }
    },
    [accessCode, minute, voiceOn, denied],
  );

  const listening = useListening((transcript) => void onAsk(transcript));

  useEffect(() => {
    setPhase((p) => (listening.listening ? 'listening' : p === 'listening' ? 'idle' : p));
  }, [listening.listening]);

  // Moving the clock returns the screen to the ambient view of that moment.
  const showingAnswer = answer !== null && answer.minute === minute;
  const ambientText = ambient.status ? { headline: ambient.status.headline, detail: ambient.status.detail } : { headline: 'Connecting to StillThere…', detail: '' };
  const spoken = showingAnswer && answer.speech ? splitSpeech(answer.speech) : null;
  const card: Card | null = showingAnswer ? (answer.card ?? (answer.speech ? null : ambient.status)) : ambient.status;

  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 pt-5 sm:px-8 sm:pt-7">
        <div className="flex shrink-0 items-baseline gap-2 whitespace-nowrap sm:gap-3">
          <span className="text-xl font-bold tracking-tight text-room-800 sm:text-2xl">StillThere</span>
          <span className="text-sm text-room-600 sm:text-base">on Alexa+</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden rounded-full border border-room-200 bg-white/70 px-3 py-1 text-xs text-room-600 lg:inline">
            Simulated Alexa+ device · answers come from the live StillThere MCP server
          </span>
          <button
            type="button"
            onClick={() => {
              if (voiceOn) stopSpeaking();
              setVoiceOn((v) => !v);
            }}
            aria-pressed={voiceOn}
            className="shrink-0 rounded-full border border-room-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-room-800 transition active:scale-95 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-800"
          >
            <span className="sm:hidden">{voiceOn ? 'Voice on' : 'Voice off'}</span>
            <span className="hidden sm:inline">{voiceOn ? 'Spoken replies on' : 'Spoken replies off'}</span>
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] grid-cols-1 gap-5 px-4 py-5 sm:gap-8 sm:px-8 sm:py-6 lg:grid-cols-[minmax(0,1fr)_330px]">
        <h1 className="sr-only">StillThere, a simulated Alexa+ experience</h1>
        <p className="text-sm text-room-600 lg:hidden">
          A simulated Alexa+ device. Every answer comes from the live StillThere MCP server.
        </p>
        <EchoShow
          dayLabel={dayLabel}
          minute={minute}
          utterance={showingAnswer ? answer.utterance : ''}
          headline={phase === 'thinking' && showingAnswer ? 'One moment…' : (spoken?.headline ?? ambientText.headline)}
          detail={phase === 'thinking' && showingAnswer ? '' : (spoken?.detail ?? ambientText.detail)}
          card={card}
          trace={showingAnswer ? answer.trace : null}
          phase={phase}
          interim={listening.interim}
          voiceSupported={listening.supported}
          onMic={() => (listening.listening ? listening.stop() : listening.start())}
          onAsk={(t) => void onAsk(t)}
        />
        {/*
          The clock comes first on a phone. It is the control the whole demo turns on,
          and below the device it sat a long scroll past the fold, where a visitor who
          never scrolled would see a single frozen moment and assume that was all.
        */}
        <div className="flex flex-col items-center gap-3">
          <div className="order-1 flex w-full flex-col items-center lg:order-2">
            <DemoClock minute={minute} playing={playing} onChange={setMinute} onPlayingChange={setPlaying} />
          </div>
          <div className="order-2 flex w-full flex-col items-center gap-3 lg:order-1">
            <Phone minute={minute} dateLabel={dateLabel} notifications={ambient.notifications} />
            <p className="text-center text-sm text-room-600">Jasmine&rsquo;s daughter&rsquo;s phone</p>
          </div>
          {ambient.error && <p className="order-3 text-sm text-[#a3481d]">{ambient.error}</p>}
        </div>
      </main>

      {accessCode === '' && (
        <AccessGate
          rejected={rejected}
          onSubmit={(code) => {
            storeCode(code);
            setRejected(false);
            setAccessCode(code);
          }}
        />
      )}
    </div>
  );
}
