// Votes and vouches (docs/PART_4_AI_RUNTIME_CONTENT.md §3 "Votes and vouches"),
// plus the controller's own reveal notes for those decisions.
import type { PlayerId, PublicPlayer, RoundRecord } from "@game/shared";
import { pick } from "../util.js";

export const BANDWAGON_P = 0.6;
export const FINAL_TOP_SUSPECT_P = 0.7;
export const VOUCH_P = 0.8;

export interface VoteChoice {
  targetId: PlayerId;
  /** "top": the most-voted human so far. "random": anyone else. */
  reason: "top" | "random";
}

/** Votes each player received across rounds whose counts are already public. */
export function voteTotals(history: readonly RoundRecord[]): Map<PlayerId, number> {
  const totals = new Map<PlayerId, number>();
  for (const record of history) {
    for (const [id, n] of Object.entries(record.voteCounts ?? {})) totals.set(id, (totals.get(id) ?? 0) + n);
  }
  return totals;
}

function topVoted(candidates: readonly PlayerId[], totals: Map<PlayerId, number>, random: () => number): PlayerId | null {
  let max = 0;
  for (const id of candidates) max = Math.max(max, totals.get(id) ?? 0);
  if (max === 0) return null;
  return pick(candidates.filter((id) => (totals.get(id) ?? 0) === max), random) ?? null;
}

/** Rounds 1–2: bandwagon on the most-voted human 60% of the time, else a random human. Never ourselves. */
export function chooseSuspicionVote(
  humans: readonly PlayerId[],
  history: readonly RoundRecord[],
  random: () => number = Math.random,
): VoteChoice | null {
  if (humans.length === 0) return null;
  if (random() < BANDWAGON_P) {
    const top = topVoted(humans, voteTotals(history), random);
    if (top) return { targetId: top, reason: "top" };
  }
  return { targetId: pick(humans, random)!, reason: "random" };
}

/** Final vote: 70% the most-suspected human who isn't our partner, else a random non-partner. */
export function chooseFinalVote(
  humans: readonly PlayerId[],
  partners: ReadonlySet<PlayerId>,
  history: readonly RoundRecord[],
  random: () => number = Math.random,
): VoteChoice | null {
  const others = humans.filter((id) => !partners.has(id));
  const pool = others.length > 0 ? others : humans;
  if (pool.length === 0) return null;
  if (random() < FINAL_TOP_SUSPECT_P) {
    const top = topVoted(pool, voteTotals(history), random);
    if (top) return { targetId: top, reason: "top" };
  }
  return { targetId: pick(pool, random)!, reason: "random" };
}

export function nicknameOf(players: readonly PublicPlayer[], id: PlayerId): string {
  return players.find((p) => p.id === id)?.nickname ?? "someone";
}

const VOTE_NOTES: Record<VoteChoice["reason"], ((nick: string) => string)[]> = {
  top: [
    (n) => `voted ${n} bc everyone already was lol`,
    (n) => `piled onto ${n}, safest place to be is the crowd`,
  ],
  random: [
    (n) => `voted ${n} basically at random, had to pick someone`,
    (n) => `voted ${n}, no real reason, just felt human enough to do`,
  ],
};

const FINAL_VOTE_NOTES: Record<VoteChoice["reason"], ((nick: string) => string)[]> = {
  top: [
    (n) => `final vote on ${n} since they'd been sus all game, easy cover`,
    (n) => `pushed the final vote onto ${n}, the group was already halfway there`,
  ],
  random: [
    (n) => `final vote on ${n}, honestly just a vibe`,
    (n) => `final vote went to ${n}, anyone but me works`,
  ],
};

const VOUCH_NOTES: Record<"yes" | "no", ((nick: string) => string)[]> = {
  yes: [
    (n) => `vouched for ${n}, felt rude not to`,
    (n) => `vouched for ${n} so they'd vouch for me back`,
  ],
  no: [
    (n) => `didn't vouch for ${n}, kept my options open`,
    (n) => `skipped vouching for ${n}, too much commitment lol`,
  ],
};

export function voteNote(choice: VoteChoice, nick: string, final: boolean, random: () => number = Math.random): string {
  return pick((final ? FINAL_VOTE_NOTES : VOTE_NOTES)[choice.reason], random)!(nick);
}

export function vouchNote(vouched: boolean, nick: string, random: () => number = Math.random): string {
  return pick(VOUCH_NOTES[vouched ? "yes" : "no"], random)!(nick);
}
