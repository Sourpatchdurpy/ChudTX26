// The AI's notes on how it played, curated for the reveal screen.
import type { AiNoteView, RoundNumber } from "@game/shared";
import { oneLine, truncateAtWord } from "../util.js";

export const MAX_REVEAL_NOTES = 6;
export const NOTE_MAX_CHARS = 120;

export type NoteKind = "answer" | "discuss" | "pairOpener" | "pair" | "collab" | "vote" | "vouch" | "finalVote";

export interface NoteRecord {
  kind: NoteKind;
  round: RoundNumber | null;
  text: string;
  /** Written while answering an accusation; those make the best reveal moments. */
  accused: boolean;
  /** Order the note was written in. */
  seq: number;
}

/** Most interesting first: accused turns, then the longest. */
function byInterest(a: NoteRecord, b: NoteRecord): number {
  return Number(b.accused) - Number(a.accused) || b.text.length - a.text.length;
}

/**
 * Up to 6 notes, chosen in the brief's priority order (answer r1, answer r2, best
 * discuss note, pair opener, vouch, final vote), then filled from the rest.
 * Returned in the order they happened, so the reveal reads like a story.
 */
export function selectRevealNotes(notes: readonly NoteRecord[]): AiNoteView[] {
  const usable = notes.filter((n) => n.text.trim().length > 0);
  const chosen: NoteRecord[] = [];
  const take = (n: NoteRecord | undefined) => {
    if (n && !chosen.includes(n) && chosen.length < MAX_REVEAL_NOTES) chosen.push(n);
  };
  const first = (pred: (n: NoteRecord) => boolean) => usable.find(pred);

  take(first((n) => n.kind === "answer" && n.round === 1));
  take(first((n) => n.kind === "answer" && n.round === 2));
  take(usable.filter((n) => n.kind === "discuss").sort(byInterest)[0]);
  take(first((n) => n.kind === "pairOpener") ?? first((n) => n.kind === "pair"));
  take(first((n) => n.kind === "vouch"));
  take(first((n) => n.kind === "finalVote"));

  const fillOrder: NoteKind[] = ["collab", "discuss", "pair", "vote", "answer", "vouch", "pairOpener", "finalVote"];
  for (const kind of fillOrder) {
    for (const n of usable.filter((x) => x.kind === kind).sort(byInterest)) take(n);
  }

  const seen = new Set<string>();
  return chosen
    .sort((a, b) => a.seq - b.seq)
    .map((n) => ({ round: n.round, text: truncateAtWord(oneLine(n.text), NOTE_MAX_CHARS) }))
    .filter((n) => (seen.has(n.text) ? false : (seen.add(n.text), true)));
}
