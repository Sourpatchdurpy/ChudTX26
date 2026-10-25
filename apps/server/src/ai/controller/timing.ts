// The AI's "phone typer" timing model (docs/PART_4_AI_RUNTIME_CONTENT.md §3).
// Messages become visible on submission; the server then enforces a send cooldown.
import { uniform } from "../util.js";

/** Reading the trigger message after it becomes visible. */
export const READ_DELAY_MS: readonly [number, number] = [800, 1_800];
export const THINK_DELAY_MS: readonly [number, number] = [200, 700];
/** Thumb typing speed, chars per second. */
export const TYPING_CPS: readonly [number, number] = [9, 15];
export const CHAT_BATCH_MS = 900;

/** Never send within this long of our last message on the same channel. */
export const MIN_GAP_MS = 8_000;
/** Never send a chat message with less than this left in the phase. */
export const MIN_PHASE_LEFT_MS = 4_000;
/** Answer / collab fallback fires this long before the phase ends. */
export const DEADLINE_GUARD_MS = 3_000;
/** Refresh a draft when multiple substantive messages have overtaken it. */
export const STALE_AFTER_MESSAGES = 2;

export function typingMs(chars: number, random: () => number = Math.random): number {
  // Do not make an already-generated reply wait through a long pretend typing session.
  return Math.min(6_000, (chars / uniform(TYPING_CPS[0], TYPING_CPS[1], random)) * 1000);
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
  const jitter = uniform(0, 1_000, random);
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
