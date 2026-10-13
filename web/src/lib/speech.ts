import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Voice in and voice out, using the browser's own speech APIs.
 *
 * Recognition exists in Chromium-based browsers and Safari; elsewhere the app falls
 * back to typing and suggestion chips, so nothing depends on a microphone. No audio
 * is sent to our backend — the browser turns speech into text, and only the text
 * leaves the page.
 */

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function useListening(onFinal: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recognition = useRef<Recognition | null>(null);
  const finalHandler = useRef(onFinal);
  finalHandler.current = onFinal;

  const supported = typeof window !== 'undefined' && recognitionCtor() !== undefined;

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    window.speechSynthesis?.cancel();

    const r = new Ctor();
    r.lang = 'en-GB';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (event) => {
      let text = '';
      let final = false;
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        text += result[0]?.transcript ?? '';
        final = final || result.isFinal;
      }
      setInterim(text);
      if (final && text.trim() !== '') finalHandler.current(text.trim());
    };
    r.onerror = () => {
      setListening(false);
      recognition.current = null;
    };
    r.onend = () => {
      setListening(false);
      setInterim('');
      recognition.current = null;
    };
    recognition.current = r;
    setListening(true);
    r.start();
  }, []);

  const stop = useCallback(() => recognition.current?.stop(), []);

  useEffect(() => () => recognition.current?.abort(), []);

  return { supported, listening, interim, start, stop };
}

/** Speaks a reply. Prefers a natural en-GB voice where the browser has one. */
export function speak(text: string, enabled: boolean): void {
  if (!enabled || typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => /en-GB/i.test(v.lang) && /natural|neural|premium|enhanced/i.test(v.name)) ??
    voices.find((v) => /en-GB/i.test(v.lang)) ??
    voices.find((v) => /^en/i.test(v.lang));
  if (preferred) utterance.voice = preferred;
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel();
}
