import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessDenied, readTool } from '../lib/api';
import type { PhoneNotification } from '../components/Phone';
import type { ExplainData, StatusData } from '../types';

/**
 * What the Echo Show and the phone display when nobody is asking anything.
 *
 * Read straight from the MCP server, never through the assistant, so moving the demo
 * clock costs no Bedrock calls.
 *
 * It chases the clock rather than debouncing it. One read is in flight at a time,
 * and when it lands the loop looks at where the clock has reached and goes again if
 * it has moved. A dragged slider therefore settles on its final position without
 * firing a request per pixel, and pressing play produces a steady stream of updates.
 *
 * The previous version debounced by 220 ms and aborted the in-flight read whenever
 * the minute changed. The play control advances every 250 ms, so every read was
 * cancelled just before it returned: the screen stayed frozen on the moment play was
 * pressed while the clock counted on beside it.
 */
export function useAmbient(minute: number, accessCode: string, onDenied: () => void) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [notifications, setNotifications] = useState<PhoneNotification[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Where the clock has reached, readable from inside a running loop without
  // re-running the effect, and so without interrupting the read in flight.
  const wanted = useRef(minute);
  wanted.current = minute;
  const running = useRef(false);
  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  const chase = useCallback(async () => {
    // A loop already running will pick up the new minute on its next turn.
    if (running.current || accessCode === '') return;
    running.current = true;
    try {
      while (!unmounted.current) {
        const target = wanted.current;
        const [s, e] = await Promise.all([
          readTool<StatusData>({ tool: 'still_there_status', demoMinute: target, accessCode }),
          readTool<ExplainData>({ tool: 'explain_last_alert', demoMinute: target, accessCode }),
        ]);
        if (unmounted.current) return;

        setError(null);
        if (s.data) setStatus(s.data);

        // Taken as given rather than merged, so winding the clock back also takes
        // messages off the phone. Each row is keyed by the minute it was sent, so
        // messages already on screen are not re-animated.
        setNotifications(e.data?.sentToday === undefined ? [] : [...e.data.sentToday]);

        if (wanted.current === target) break; // caught up
      }
    } catch (err) {
      if (unmounted.current) return;
      if (err instanceof AccessDenied) onDenied();
      else setError("Can't reach StillThere right now.");
    } finally {
      running.current = false;
    }
  }, [accessCode, onDenied]);

  useEffect(() => {
    void chase();
  }, [minute, chase]);

  return { status, notifications, error };
}
