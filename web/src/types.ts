/**
 * Mirrors the structuredContent the MCP tools return. Kept as a copy rather than an
 * import so the web app has no build-time dependency on the backend package.
 */

export type Severity = 'low' | 'medium' | 'high';
export type HabitState = 'done' | 'overdue' | 'waiting' | 'cannot_see';
export type StatusState = 'normal' | 'overdue' | 'cannot_see' | 'paused' | 'night' | 'learning';

export interface HabitToday {
  key: string;
  name: string;
  label: string;
  usualMinute: number;
  deadlineMinute: number;
  happenedAtMinute: number | null;
  state: HabitState;
  presentDays: number;
  observedDays: number;
}

export interface StatusData {
  kind: 'status';
  state: StatusState;
  severity: Severity | null;
  residentName: string | null;
  dateKey: string;
  nowMinute: number;
  headline: string;
  detail: string;
  habits: HabitToday[];
  activityMinutes: number[];
  ignored: { notAPerson: number; outside: number };
  pausedUntil: string | null;
  pauseReason: string | null;
}

export interface RoutineHabit {
  key: string;
  name: string;
  label: string;
  usualMinute: number;
  latestNormalMinute: number;
  reliability: number;
  presentDays: number;
  observedDays: number;
}

export interface RoutineData {
  kind: 'routine';
  residentName: string | null;
  daysObserved: number;
  weekday: RoutineHabit[];
  weekend: RoutineHabit[];
}

export interface ExplainData {
  kind: 'explanation';
  found: boolean;
  sentToday: { sentAtMinute: number; severity: Severity; message: string }[];
  dateKey: string | null;
  sentAtMinute: number | null;
  severity: Severity | null;
  message: string | null;
  phrasedBy: 'bedrock' | 'deterministic' | null;
  findings: {
    name: string;
    label: string;
    usualMinute: number;
    expectedByMinute: number;
    minutesOverdue: number;
    presentDays: number;
    observedDays: number;
  }[];
}

export interface PauseData {
  kind: 'paused';
  untilDateKey: string;
  reason: string;
  days: number;
}

export interface ResumeData {
  kind: 'resumed';
  wasPaused: boolean;
}

export type Card = StatusData | RoutineData | ExplainData | PauseData | ResumeData;

export interface Trace {
  router: 'bedrock' | 'keywords';
  routerNote?: string;
  model?: string;
  tool: string | null;
  protocolVersion: string;
  server: string;
  toolsDiscovered: number;
  timings: { connectMs: number; modelMs?: number; toolMs?: number; totalMs: number };
}

export interface AssistantReply {
  speech: string;
  card: Card | null;
  trace: Trace | null;
}

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export function hhmm(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
