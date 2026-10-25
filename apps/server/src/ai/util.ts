// Small helpers shared by the AI runtime (Part 4). No Muse calls, no game state.

export class TimeoutError extends Error {
  constructor(message = "timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export class AbortedError extends Error {
  constructor(message = "aborted") {
    super(message);
    this.name = "AbortedError";
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Resolve with `p`, or reject with TimeoutError after `ms` (or AbortedError if
 * `signal` aborts first). Does not cancel `p` itself: pass the same signal to
 * the underlying work if it should stop too.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const timer = setTimeout(() => {
      cleanup();
      reject(new TimeoutError(`timed out after ${ms}ms`));
    }, Math.max(0, ms));
    const onAbort = () => {
      cleanup();
      reject(new AbortedError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        cleanup();
        resolve(v);
      },
      (e: unknown) => {
        cleanup();
        reject(e);
      },
    );
  });
}

/** Uniform float in [lo, hi). */
export function uniform(lo: number, hi: number, random: () => number = Math.random): number {
  return lo + (hi - lo) * random();
}

/** Uniform integer in [lo, hi] (inclusive). */
export function randInt(lo: number, hi: number, random: () => number = Math.random): number {
  return lo + Math.floor(random() * (hi - lo + 1));
}

export function pick<T>(items: readonly T[], random: () => number = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(random() * items.length)];
}

/** Fisher–Yates; returns a new array. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Collapse whitespace and newlines into single spaces and trim. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cut to at most `max` chars, preferring a word boundary. Never returns more than `max` chars. */
export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space >= max * 0.5 ? cut.slice(0, space) : cut).trimEnd();
}
