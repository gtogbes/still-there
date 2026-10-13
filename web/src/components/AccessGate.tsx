import { useEffect, useRef, useState } from 'react';

/**
 * Asks for the demo access code once per browser session.
 *
 * sessionStorage rather than localStorage: the code is forgotten when the tab
 * closes. It is a shared demo code, not a personal credential, but there is no
 * reason to keep it on disk either.
 */

const KEY = 'still-there-access';

export function readStoredCode(): string {
  return sessionStorage.getItem(KEY) ?? '';
}

export function storeCode(code: string): void {
  if (code === '') sessionStorage.removeItem(KEY);
  else sessionStorage.setItem(KEY, code);
}

export function AccessGate({ rejected, onSubmit }: { rejected: boolean; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-room-800/40 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <form
        className="animate-rise w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim() !== '') onSubmit(code.trim());
        }}
      >
        <h1 id="gate-title" className="text-2xl font-semibold text-room-800">
          StillThere on Alexa+
        </h1>
        <p className="mt-2 text-room-600">
          Enter the access code from the submission&rsquo;s testing instructions. It keeps the assistant, which calls Amazon Bedrock, from being run by strangers.
        </p>
        <label htmlFor="code" className="mt-6 block text-sm font-medium text-room-800">
          Access code
        </label>
        <input
          ref={input}
          id="code"
          type="password"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={rejected}
          aria-describedby={rejected ? 'code-error' : undefined}
          className="mt-1.5 h-12 w-full rounded-xl border border-room-200 px-4 text-room-800 focus:border-room-800 focus:outline-none"
        />
        {rejected && (
          <p id="code-error" className="mt-2 text-sm text-[#a3481d]">
            That code wasn&rsquo;t accepted. Check it and try again.
          </p>
        )}
        <button
          type="submit"
          className="mt-6 h-12 w-full rounded-xl bg-room-800 font-semibold text-white transition hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-800"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
