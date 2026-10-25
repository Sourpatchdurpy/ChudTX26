// Env-derived settings. Read lazily (not at import time) because index.ts loads
// the root .env after static imports have already been evaluated.
import { CHAT_DELAY_MS, DEFAULT_TIMERS, type Phase } from "@game/shared";

export type AiModeName = "stub" | "muse";

export function aiMode(): AiModeName {
  return process.env.AI_MODE === "muse" ? "muse" : "stub";
}

export function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

function envNumber(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function timerScale(): number {
  const n = envNumber("TIMER_SCALE");
  return n !== null && n > 0 ? n : 1;
}

/** DEFAULT_TIMERS[phase] * TIMER_SCALE, or null for host-advanced phases. */
export function phaseDurationMs(phase: Phase): number | null {
  const base = DEFAULT_TIMERS[phase];
  return base === null ? null : Math.round(base * timerScale());
}

export function chatDelayMs(): number {
  const n = envNumber("CHAT_DELAY_MS");
  return n !== null && n >= 0 ? n : CHAT_DELAY_MS;
}

/** When everyone has answered, the answer phase ends this long after. */
export const ALL_ANSWERED_GRACE_MS = 2_000;
/** When everyone has voted, the vote phase ends this long after. */
export const ALL_VOTED_GRACE_MS = 1_500;
/** Max wait for the AI persona at game start before freezing a complete fallback persona. */
export const PERSONA_WAIT_MS = 10_000;
/** Timeout passed to runMatchmaker; we also race it ourselves slightly longer. */
export const MATCHMAKER_TIMEOUT_MS = 8_000;
export const MATCHMAKER_HARD_TIMEOUT_MS = 9_000;
