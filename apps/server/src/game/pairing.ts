// Round 3 pairing: validate the matchmaker's output (or fall back to random),
// then insert the AI by the rules in MASTER_PLAN §3.
import { nanoid } from "nanoid";
import type { MatchmakerOutput, Pair, PlayerId } from "@game/shared";
import { pick, shuffle } from "./random.js";

export interface HumanPairing {
  humanPairs: [PlayerId, PlayerId][];
  leftover: PlayerId | null;
}

/** Shuffle, chunk by 2, odd one out = leftover. */
export function randomPairing(humans: readonly PlayerId[]): HumanPairing {
  const s = shuffle(humans);
  const leftover = s.length % 2 === 1 ? s.pop()! : null;
  const humanPairs: [PlayerId, PlayerId][] = [];
  for (let i = 0; i < s.length; i += 2) humanPairs.push([s[i]!, s[i + 1]!]);
  return { humanPairs, leftover };
}

/** Every human exactly once across humanPairs + leftover; pairs of 2; leftover iff odd. */
export function isValidPairing(out: HumanPairing | null | undefined, humans: readonly PlayerId[]): boolean {
  if (!out || !Array.isArray(out.humanPairs)) return false;
  const known = new Set(humans);
  const seen = new Set<PlayerId>();
  const add = (id: unknown): boolean => {
    if (typeof id !== "string" || !known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  };
  for (const pair of out.humanPairs) {
    if (!Array.isArray(pair) || pair.length !== 2) return false;
    if (!add(pair[0]) || !add(pair[1])) return false;
  }
  const odd = humans.length % 2 === 1;
  if (odd !== (out.leftover !== null && out.leftover !== undefined)) return false;
  if (odd && !add(out.leftover)) return false;
  return seen.size === known.size;
}

/**
 * Odd humans: [leftover, AI] is its own pair. Even humans: the AI joins a random
 * pair (a trio). Members and pair order are shuffled so array position never
 * hints at the AI.
 */
export function applyPairing(out: MatchmakerOutput | null, humans: readonly PlayerId[], aiId: PlayerId): Pair[] {
  const base: HumanPairing = isValidPairing(out, humans) ? out! : randomPairing(humans);
  const groups: PlayerId[][] = base.humanPairs.map((p) => [...p]);
  if (base.leftover !== null) groups.push([base.leftover, aiId]);
  else if (groups.length > 0) pick(groups).push(aiId);
  else groups.push([aiId]); // unreachable with >= 3 humans; keeps the AI seated anyway
  return shuffle(groups).map((members) => ({ id: nanoid(8), members: shuffle(members) }));
}
