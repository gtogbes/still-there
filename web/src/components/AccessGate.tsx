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
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-room-800/45 p-4 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <form
        className="animate-rise w-full max-w-md rounded-3xl bg-white p-6 shadow-[0_30px_80px_-20px_rgba(50,42,30,0.5)] sm:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim() !== '') onSubmit(code.trim());
        }}
      >
        <h1 id="gate-title" className="text-xl font-semibold text-room-800 sm:text-2xl">
          StillThere on Alexa+
        </h1>
        <p className="mt-2 text-[15px] text-room-600 sm:text-base">
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
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={rejected}
          aria-describedby={rejected ? 'code-error' : undefined}
          className="mt-1.5 h-12 w-full rounded-xl border border-room-200 px-4 text-base text-room-800 focus:border-room-800 focus:outline-none"
        />
        {rejected && (
          <p id="code-error" className="mt-2 text-sm text-[#a3481d]">
            That code wasn&rsquo;t accepted. Check it and try again.
          </p>
        )}
        <button
          type="submit"
          className="mt-6 h-12 w-full rounded-xl bg-room-800 font-semibold text-white transition active:scale-[0.98] hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-800"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
