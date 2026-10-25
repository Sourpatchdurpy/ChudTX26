// What the controller needs from the outside world. Kept as an interface so the
// controller never imports Part 2's module directly (createAiPlayer.ts wires the
// real one) and tests can pass fakes.
import type {
  AiTurnContext, ChatMessage, MuseChatRequest, Persona,
  PlayerId, RoundAnswer, StyleProfile, Tier,
} from "@game/shared";
import type { MuseCallFn } from "../muse.js";

/** Part 2's exports (docs/PART_2_AI_HUMANNESS.md §2) that the controller calls. */
export interface HumannessDeps {
  buildAnswerRequest(ctx: AiTurnContext): MuseChatRequest;
  buildGroupChatRequest(ctx: AiTurnContext): MuseChatRequest;
  buildPairChatRequest(ctx: AiTurnContext): MuseChatRequest;
  buildCollabRequest(ctx: AiTurnContext): MuseChatRequest;
  computeStyleProfile(messages: ChatMessage[], answers: RoundAnswer[], aiPlayerId: PlayerId): StyleProfile;
  humanize(text: string, style: StyleProfile, persona: Persona): string;
  validateOutput(text: string): { ok: true } | { ok: false; reason: string };
  FALLBACK_LINES: {
    answer: Record<Exclude<Tier, "collab">, string[]>;
    collab: string[];
    group: string[];
    accused: string[];
    pair: string[];
  };
}

export interface ControllerDeps {
  humanness: HumannessDeps;
  call: MuseCallFn;
  /** Defaults to Math.random. Tests pass a seeded PRNG. */
  random?: () => number;
  /** Called from dispose() to print this game's Muse usage summary. */
  logRoomStats?: (roomCode: string) => void;
}
