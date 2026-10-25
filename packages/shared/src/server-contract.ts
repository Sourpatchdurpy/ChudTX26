// ─────────────────────────────────────────────────────────────────────────────
// SERVER-INTERNAL CONTRACT between the game server (Part 3), the AI runtime
// (Part 4) and the AI humanness layer (Part 2). Never sent to browsers.
// Lives in the shared package only so there is one source of truth.
// ─────────────────────────────────────────────────────────────────────────────

import type { AckResult } from "./events";
import type {
  AiNoteView,
  Channel,
  ChatMessage,
  Phase,
  PlayerId,
  RoomCode,
  RoomView,
  RoundNumber,
  RoundRecord,
} from "./types";

// ── AI player ↔ game server ──────────────────────────────────────────────────
// The AI is a "virtual client": the server gives it exactly the RoomView a
// human in its seat would get (me = the AI), and it acts only through
// AiActions, which run the same validation and the same chat delay as human
// socket events. The sole information exception is the private round-one
// submitted-answer snapshot below; it is never included in a browser view.

export interface FirstQuestionAnswerSnapshot {
  sessionGeneration: string;
  round: 1;
  promptId: string;
  question: string;
  revision: number;
  humanPlayerIds: PlayerId[];
  submittedCount: number;
  answers: { playerId: PlayerId; nickname: string; text: string }[];
}

export type GameEvent =
  | { type: "firstQuestionAnswersUpdated"; snapshot: FirstQuestionAnswerSnapshot }
  | { type: "gameStarted" }
  | { type: "phaseChanged"; phase: Phase; round: RoundNumber | null }
  /** A message just became visible to the AI (after the send delay). Includes the AI's own messages. */
  | { type: "messageVisible"; message: ChatMessage }
  /** Anything else changed (progress counters, votes counts, etc.). */
  | { type: "stateUpdated" };

export interface AiActions {
  submitAnswer(text: string): AckResult;
  sendChat(text: string, channel: Channel): AckResult<{ messageId: string; visibleAt: number }>;
  castVote(targetId: PlayerId): AckResult;
  submitCollab(text: string): AckResult;
  setVouch(targetId: PlayerId, vouched: boolean): AckResult;
}

export interface AiPlayer {
  /** Called on every change. Must return fast and never throw: do async work in the background. */
  onEvent(event: GameEvent, view: RoomView): void;
  /** Called once when the game reaches "reveal". */
  // persona.name is the assigned game nickname, not a generated persona field.
  getRevealInfo(): { persona: { name: string; blurb: string }; notes: AiNoteView[] };
  /** Stop timers and pending Muse calls (room ended or deleted). */
  dispose(): void;
}

export interface AiPlayerInit {
  sessionGeneration: string;
  roomCode: RoomCode;
  aiPlayerId: PlayerId;
  persona: Persona;
  actions: AiActions;
}

/** Implemented by Part 4 (apps/server/src/ai/controller). */
export type CreateAiPlayer = (init: AiPlayerInit) => AiPlayer;

/**
 * Implemented by Part 4. Called by the server when a room is created, so it
 * runs while people join. Fetches (cached) world context, then calls Part 2's
 * generatePersona. Must resolve with a usable Persona even on failure
 * (fallback persona from Part 2's pool).
 */
export type PrepareAiPersona = (opts: { roomCode: RoomCode; signal?: AbortSignal }) => Promise<Persona>;

// ── Persona & world context (Part 2 designs Persona; Part 4 fills WorldContext) ──

export interface WorldContext {
  fetchedAt: number;
  trending: string[]; // what people are talking about this week
  news: string[]; // a few current headlines (national + Austin)
  local: string[]; // UT Austin / Austin details a student would know
  weather: string | null; // e.g. "low 80s and humid in Austin today"
  hacktx: string[]; // static facts about the event (menu, schedule, venue) — hand-written
}

export interface Persona {
  age: number;
  school?: string;
  year?: string;
  major?: string;
  hometown: string;
  interests: string[];
  opinions: string[]; // a few strong, specific takes
  facts: string[]; // concrete biographical details to stay consistent with
  thisWeek: string[]; // things they did/saw this week, grounded in WorldContext
  style: {
    casing: "lowercase" | "mixed";
    emojiRate: number; // average emojis per message, e.g. 0.2
    slang: string[]; // a few words they actually use
    punctuation: "minimal" | "normal";
  };
  blurb: string; // name-free reveal description, e.g. "geography student from San Marcos"
  /** Part 2 may add fields here without a contract change. */
  extra?: Record<string, unknown>;
}

// ── Matchmaker (Part 4) ─────────────────────────────────────────────────────

export interface MatchmakerInput {
  humans: { id: PlayerId; nickname: string; realName: string }[];
  aiPlayerId: PlayerId; // exclude the AI's answers/messages from matching
  rounds: RoundRecord[]; // rounds 1–2, with answers
  groupMessages: ChatMessage[];
}

export interface MatchmakerOutput {
  /** Pairs of exactly 2 humans. Every human appears once, except `leftover`. */
  humanPairs: [PlayerId, PlayerId][];
  /** Exactly one human when the human count is odd (they get paired with the AI); otherwise null. */
  leftover: PlayerId | null;
  /** Optional one-liners about what each pair shares, e.g. "both quit piano at 12". */
  sharedThings: { a: PlayerId; b: PlayerId; text: string }[];
  /** For the leftover (whose partner will be the AI): another human to go talk to after the game. */
  suggestionForLeftover: { targetId: PlayerId; reason: string } | null;
}

/** Implemented by Part 4. Must resolve within timeoutMs; on failure return a random valid pairing. */
export type RunMatchmaker = (input: MatchmakerInput, opts: { timeoutMs: number }) => Promise<MatchmakerOutput>;

// ── Part 2 (prompts/humanizing) ↔ Part 4 (runtime) ───────────────────────────

/** Request body for chat.completions.create, minus `model` (Part 4's wrapper adds it). */
export interface MuseChatRequest {
  messages: { role: "developer" | "system" | "user" | "assistant"; content: string }[];
  response_format?: {
    type: "json_schema";
    json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean };
  };
  reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  max_completion_tokens?: number;
  prompt_cache_key?: string;
}

/**
 * Part 4's Muse wrapper (apps/server/src/ai/muse.ts). Sends the request,
 * enforces a timeout, retries once on 429/5xx/timeout, JSON-parses
 * choices[0].message.content and returns it. Throws on final failure.
 * Callers must still sanity-check fields (it's a cast, not a validation).
 */
export type MuseCall = <T>(req: MuseChatRequest, opts?: {
  timeoutMs?: number;
  label?: string;
  signal?: AbortSignal;
  deadlineAtMs?: number;
}) => Promise<T>;

/** How the humans in this room are texting. Computed by Part 2's computeStyleProfile. */
export interface StyleProfile {
  medianChars: number;
  lowercaseStartRatio: number; // share of human messages that start lowercase
  endsWithPeriodRatio: number;
  emojiPerMessage: number;
  commonTokens: string[]; // slang/abbreviations seen: "lol", "ngl", "fr", "💀"
  sampleMessages: string[]; // up to 8 recent human messages to mirror
}

export type AiMode = "answer" | "group" | "pair" | "collab";

/** Everything Part 2's request builders need for one AI turn. Built by Part 4's controller. */
export interface AiTurnContext {
  mode: AiMode;
  persona: Persona;
  view: RoomView; // the AI's own view (me = the AI)
  aiPlayerId: PlayerId;
  myNickname: string;
  style: StyleProfile;
  trigger: { kind: "phaseStart" } | { kind: "message"; message: ChatMessage } | { kind: "idle" };
  /** True if a human mentioned the AI's nickname, or it's a pair message from the AI's partner. */
  addressedToMe: boolean;
  /** Everything the AI has said this game (answers, messages, results), oldest first, for consistency. */
  saidSoFar: string[];
  secondsLeftInPhase: number;
}

/** Structured outputs Part 2's request builders ask Muse for. */
export interface AiAnswerOutput {
  answer: string;
  note: string; // first-person note for the reveal, <= ~100 chars
}
export interface AiChatOutput {
  action: "send" | "skip";
  message: string; // "" when action === "skip"
  note: string;
}
export interface AiCollabOutput {
  result: string;
  note: string;
}
