// Loads and validates content/question-bank.json, and picks prompts per round
// without repeating within a room's session (usedIds persists across play again).
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { CollabCard, Question, QuestionBank } from "@game/shared";
import { pick } from "./random.js";

const QuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

const CollabCardSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  submitPrompt: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

const QuestionBankSchema = z.object({
  _readme: z.string().optional(),
  rounds: z.tuple([z.literal("light"), z.literal("personal"), z.literal("collab")]),
  tiers: z.object({
    light: z.array(QuestionSchema).min(1),
    personal: z.array(QuestionSchema).min(1),
    deep: z.array(QuestionSchema),
  }),
  collab: z.array(CollabCardSchema).min(1),
});

const DEFAULT_PATH = new URL("../../../../content/question-bank.json", import.meta.url);

export type QuestionTier = keyof QuestionBank["tiers"];

export class ContentStore {
  constructor(readonly bank: QuestionBank) {}

  /** Random question from the tier, avoiding usedIds; reuses the tier once exhausted. */
  pickQuestion(tier: QuestionTier, usedIds: Set<string>): Question {
    const all = this.bank.tiers[tier];
    const fresh = all.filter((q) => !usedIds.has(q.id));
    const q = pick(fresh.length > 0 ? fresh : all);
    usedIds.add(q.id);
    return q;
  }

  /** Random collab card with "{deep}" replaced by a random deep question. */
  pickCollab(usedIds: Set<string>): { card: CollabCard; prompt: string } {
    const fresh = this.bank.collab.filter((c) => !usedIds.has(c.id));
    const card = pick(fresh.length > 0 ? fresh : this.bank.collab);
    usedIds.add(card.id);
    let prompt = card.text;
    if (prompt.includes("{deep}") && this.bank.tiers.deep.length > 0) {
      prompt = prompt.replaceAll("{deep}", this.pickQuestion("deep", usedIds).text);
    }
    return { card, prompt };
  }
}

/** Throws with a readable message if the file is missing or invalid. */
export function loadContent(path: URL | string = DEFAULT_PATH): ContentStore {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = QuestionBankSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`question-bank.json is invalid:\n${z.prettifyError(parsed.error)}`);
  }
  const bank = parsed.data as QuestionBank;
  const ids = [...bank.tiers.light, ...bank.tiers.personal, ...bank.tiers.deep, ...bank.collab].map((x) => x.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) throw new Error(`question-bank.json has duplicate ids: ${[...new Set(dupes)].join(", ")}`);
  if (bank.tiers.deep.length === 0 && bank.collab.some((c) => c.text.includes("{deep}"))) {
    console.warn("[content] collab cards use {deep} but tiers.deep is empty; {deep} will be left as-is");
  }
  return new ContentStore(bank);
}
