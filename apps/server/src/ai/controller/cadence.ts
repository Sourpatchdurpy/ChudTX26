// When the AI speaks in chat (docs/PART_4_AI_RUNTIME_CONTENT.md §3 "Cadence rules").
import { clamp } from "../util.js";

export const ADDRESSED_REPLY_P = 0.85;
export const DISCUSS_OPENER_P = 0.45;
export const PAIR_OPENER_P = 0.5;
export const PAIR_REPLY_P = 0.9;

const ACCUSATION_RE = /(^|[^\p{L}\p{N}])(bots?|ai|a\.i\.?|sus|sussy|robot|chat ?gpt|gpt|llm|clanker|npc|fake|computer)(?![\p{L}\p{N}])/iu;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Fox", "fox?", "@Fox", "Fox's" match; "Foxes" and "Bee" inside "been" don't. */
export function mentionsNickname(text: string, nickname: string): boolean {
  if (!nickname) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])@?${escapeRegExp(nickname)}(?![\\p{L}\\p{N}_])`, "iu");
  return re.test(text);
}

function normalizeWords(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

/** True if `text` repeats any 3 consecutive words (≥10 chars) of one of our answers. */
export function quotesAnswer(text: string, answers: readonly string[]): boolean {
  const hay = ` ${normalizeWords(text).join(" ")} `;
  for (const answer of answers) {
    const words = normalizeWords(answer);
    for (let i = 0; i + 3 <= words.length; i++) {
      const gram = words.slice(i, i + 3).join(" ");
      if (gram.length >= 10 && hay.includes(` ${gram} `)) return true;
    }
  }
  return false;
}

export interface Addressing {
  addressed: boolean;
  /** Mentions us plus "bot", "ai", "sus"... Part 2's prompt handles the tone; we use it for fallbacks and notes. */
  accused: boolean;
}

export function classifyMessage(text: string, myNickname: string, myAnswers: readonly string[]): Addressing {
  const mentioned = mentionsNickname(text, myNickname);
  const accused = mentioned && ACCUSATION_RE.test(text);
  return { addressed: mentioned || quotesAnswer(text, myAnswers), accused };
}

/** Chance to reply to a group message that wasn't addressed to us, from this phase's counts. */
export function replyProbability(medianHumanCount: number, myCount: number): number {
  return clamp(0.25 + 0.15 * (medianHumanCount - myCount), 0.05, 0.6);
}
