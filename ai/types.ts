import type { AiTurnContext, FirstQuestionAnswerSnapshot, PublicPlayer, ChatMessage, RoundNumber, AiMode } from "@game/shared";

export interface Measurements {
  sampleCount: number; wordCounts: number[]; medianWords: number; minWords: number; maxWords: number;
  totalWords: number; lowercaseWords: number; lowercaseWordRatio: number;
  sentences: number; periodSentences: number; periodSentenceRatio: number;
  emojiMessages: number; emojiMessageRatio: number;
}
export interface ChatterProfile extends Measurements {
  playerId: string; commonTokens: string[]; sampleMessages: string[]; tentative: boolean;
}
export interface AnswerExample {
  sessionGeneration: string; round: RoundNumber; promptId: string; question: string;
  authorId: string; nickname: string; authorKind: "self" | "human";
  visibility: "revealed" | "submitted-not-revealed"; answer: string; sourceKey: string;
}
export interface Evidence { sourceId: string; quote: string; older?: boolean }
export interface PlayerStance {
  playerId: string; stance: "unknown" | "neutral" | "skeptical" | "defending" | "mixed";
  strength: "none" | "tentative" | "explicit"; evidence: Evidence[]; latestPosition: number;
  unresolvedQuestions: Evidence[];
}
export interface AcceptedOutput {
  key: string; text: string; mode: AiMode; round: RoundNumber; promptId: string; question: string;
  messageId?: string; visibleAt?: number; visibility: "pending" | "visible"; note?: string;
}
export interface SessionMemory {
  sessionGeneration: string; roster: PublicPlayer[]; summary: string; summarizedThroughMessageId: string | null;
  establishedAiFacts: string[]; chatterProfiles: Record<string, ChatterProfile>; playerStances: Record<string, PlayerStance>;
  answerExamples: AnswerExample[]; messages: ChatMessage[]; processedMessageIds: Set<string>;
  visibleAnswerKeys: Set<string>; acceptedOutputs: AcceptedOutput[]; revision: number; disposed: boolean;
  taskKey: string; taskMessageStart: number;
}
export type TierName = "baseline" | "expanded" | "complex" | "high";
export interface GenerationPolicy {
  /** Higher tiers must have both approval and measured evaluation before selection. */
  approved: TierName[]; evaluated: TierName[]; p90Ms: Record<TierName, number>;
  highEscalation?: boolean;
}
export interface GenerationState { tier: TierName; belowCount: number }
export type PlayerTurnContext = AiTurnContext & {
  memory?: SessionMemory; firstQuestionHumanAnswers?: FirstQuestionAnswerSnapshot;
  firstQuestionDeadlineException?: boolean; generationPolicy?: GenerationPolicy;
  generationState?: GenerationState; generationCutoffAt?: number; nowMs?: number;
  regenerationFeedback?: string;
};
