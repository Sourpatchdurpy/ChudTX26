// When the AI speaks in chat (docs/PART_4_AI_RUNTIME_CONTENT.md §3 "Cadence rules").
import { asksForChatReply } from "@game/ai";
import { clamp } from "../util.js";
export { asksForChatReply, isLowValueChat, isResolvedChat } from "@game/ai";

export const ADDRESSED_REPLY_P = 0.85;
export const DISCUSS_OPENER_P = 0.45;
/** A reply counts as aimed at the AI if it follows the AI's own message within this long. */
export const REPLY_WINDOW_MS = 30_000;
export const PAIR_OPENER_P = 0.5;
export const PAIR_REPLY_P = 0.9;

const ACCUSATION_RE = /(^|[^\p{L}\p{N}])(bots?|ai|a\.i\.?|sus|sussy|robot(?:ic)?|automated|scripted|chat ?gpt|gpt|llm|clanker|npc|fake|computer)(?![\p{L}\p{N}])/iu;

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
  const quoted = quotesAnswer(text, myAnswers);
  const accused = (mentioned || quoted) && ACCUSATION_RE.test(text);
  return { addressed: mentioned || quoted, accused };
}

const GROUP_WORDS_RE = /(^|[^\p{L}\p{N}])(every(one|body)|any(one|body)|any of (you|u)|y'?all|you guys|u guys|guys|all of (you|u)|who here|who else|ppl|people|chat)(?![\p{L}\p{N}])/iu;

/** A question put to the whole group ("what does everyone pick?", "anyone been there?"). */
export function isGroupQuestion(text: string): boolean {
  return asksForChatReply(text) && GROUP_WORDS_RE.test(text);
}

/**
 * Chance to reply to a group message that wasn't addressed to us, from this phase's counts:
 * talk about as much as the median human (playtesters found the AI too quiet at 0.12–0.35).
 */
export function replyProbability(medianHumanCount: number, myCount: number): number {
  return clamp(0.25 + 0.15 * (medianHumanCount - myCount), 0.05, 0.6);
}
