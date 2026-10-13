import { useEffect, useState } from 'react';
import { AccessDenied, readTool } from '../lib/api';
import type { PhoneNotification } from '../components/Phone';
import type { ExplainData, StatusData } from '../types';

/**
 * What the Echo Show and the phone display when nobody is asking anything.
 *
 * Read straight from the MCP server, never through the assistant, so moving the demo
 * clock costs no Bedrock calls. Debounced, because a dragged slider fires dozens of
 * change events a second and only the one it settles on matters.
 */
export function useAmbient(minute: number, accessCode: string, onDenied: () => void) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [notifications, setNotifications] = useState<PhoneNotification[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (accessCode === '') return;
    const controller = new AbortController();

    const id = window.setTimeout(async () => {
      try {
        const [s, e] = await Promise.all([
          readTool<StatusData>({ tool: 'still_there_status', demoMinute: minute, accessCode, signal: controller.signal }),
          readTool<ExplainData>({ tool: 'explain_last_alert', demoMinute: minute, accessCode, signal: controller.signal }),
        ]);
        setError(null);
        if (s.data) setStatus(s.data);

        // Everything sent today up to this moment. Merged rather than replaced, so a
        // notification already on screen keeps its place when the clock moves on.
        const sent = e.data?.sentToday ?? [];
        setNotifications((prev) => {
          const known = new Set(prev.map((n) => n.sentAtMinute));
          const added = sent.filter((n) => !known.has(n.sentAtMinute));
          return added.length === 0 ? prev : [...prev, ...added];
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof AccessDenied) onDenied();
        else setError("Can't reach StillThere right now.");
      }
    }, 220);

    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
  }, [minute, accessCode, onDenied]);

  return { status, notifications, error };
}
