// The AI's "phone typer" timing model (docs/PART_4_AI_RUNTIME_CONTENT.md §3).
// The server adds CHAT_DELAY_MS on top of everything here, for everyone.
import { AI_EXTRA_JITTER_MS } from "@game/shared";
import { uniform } from "../util.js";

/** Reading the trigger message after it becomes visible. */
export const READ_DELAY_MS: readonly [number, number] = [1_500, 4_000];
export const THINK_DELAY_MS: readonly [number, number] = [500, 2_000];
/** Thumb typing speed, chars per second. */
export const TYPING_CPS: readonly [number, number] = [4, 7];

/** Never send within this long of our last message on the same channel. */
export const MIN_GAP_MS = 8_000;
/** Never send a chat message with less than this left in the phase. */
export const MIN_PHASE_LEFT_MS = 4_000;
/** Answer / collab fallback fires this long before the phase ends. */
export const DEADLINE_GUARD_MS = 3_000;
/** A reply is dropped as stale once this many newer messages arrived (unless it was addressed to us). */
export const STALE_AFTER_MESSAGES = 3;

export function typingMs(chars: number, random: () => number = Math.random): number {
  return (chars / uniform(TYPING_CPS[0], TYPING_CPS[1], random)) * 1000;
}

/**
 * Earliest moment a reply of `chars` characters may be sent.
 * `includeRead` is false for openers, whose scheduled start already stands in for reading.
 */
export function computeSendAt(
  triggerAt: number,
  chars: number,
  random: () => number = Math.random,
  includeRead = true,
): number {
  const read = includeRead ? uniform(READ_DELAY_MS[0], READ_DELAY_MS[1], random) : 0;
  const think = uniform(THINK_DELAY_MS[0], THINK_DELAY_MS[1], random);
  const jitter = uniform(AI_EXTRA_JITTER_MS[0], AI_EXTRA_JITTER_MS[1], random);
  return triggerAt + read + think + typingMs(chars, random) + jitter;
}

/** A random moment between the `lo` and `hi` fractions of a phase. */
export function slotAt(
  phaseStart: number,
  phaseEnd: number,
  lo: number,
  hi: number,
  random: () => number = Math.random,
): number {
  return phaseStart + uniform(lo, hi, random) * (phaseEnd - phaseStart);
}
