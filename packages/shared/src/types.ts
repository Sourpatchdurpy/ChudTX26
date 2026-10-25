// ─────────────────────────────────────────────────────────────────────────────
// SHARED CONTRACT: client-visible types.
// Owner: Part 3 (game server). Everyone else imports, nobody edits without
// announcing in the team chat first (see docs/MASTER_PLAN.md §8 "Contract rules").
//
// PRIVACY RULE: nothing in these types may reveal which player is the AI, or a
// human's real name, before the "reveal" phase. The server builds a separate
// RoomView per viewer, so a field only appears once that viewer may see it.
// ─────────────────────────────────────────────────────────────────────────────

export type PlayerId = string;
export type RoomCode = string; // 4 uppercase letters, e.g. "KQZT"
export type PairId = string;
export type RoundNumber = 1 | 2 | 3;

/** Rounds 1–2 use question tiers; round 3 is the collaboration round. */
export type Tier = "light" | "personal" | "collab";

export type Phase =
  | "lobby" // players joining; host can start
  | "answer" // rounds 1–2: everyone privately types an answer
  | "discuss" // rounds 1–2: all answers shown at once + group chat
  | "vote" // rounds 1–2: suspicion vote (nobody leaves)
  | "voteResult" // rounds 1–2: vote counts shown for a few seconds
  | "pairChat" // round 3: private pair chat + each partner submits one result
  | "pairResults" // round 3: every pair's results shown + each player sets vouches
  | "finalVote" // round 3: vouches shown, final vote decides the game
  | "reveal" // real names, the AI, its notes, vouches, most suspicious human
  | "partners"; // each phone shows its own partner card

export type Channel = "group" | "pair";

/** What every player sees about every player during the game (no real names, no host flag, no AI flag). */
export interface PublicPlayer {
  id: PlayerId;
  nickname: string; // e.g. "Fox"
  emoji: string; // e.g. "🦊"
}

export interface ChatMessage {
  id: string;
  channel: Channel;
  pairId: PairId | null; // set when channel === "pair"
  from: PlayerId;
  text: string;
  /** Server time (ms) when the message became visible, i.e. after the send delay. */
  at: number;
}

export interface RoundAnswer {
  playerId: PlayerId;
  text: string | null; // null = didn't answer in time
}

/** One completed or in-progress round. Answers stay empty until the "discuss" phase. */
export interface RoundRecord {
  round: RoundNumber;
  tier: Tier;
  promptId: string;
  prompt: string;
  answers: RoundAnswer[]; // rounds 1–2 only; [] for round 3
  voteCounts: Record<PlayerId, number> | null; // rounds 1–2, filled at "voteResult"
}

export interface Pair {
  id: PairId;
  members: PlayerId[]; // 2, or 3 for a trio
}

export interface Vouch {
  from: PlayerId;
  target: PlayerId;
  vouched: boolean;
}

export interface AiNoteView {
  round: RoundNumber | null;
  text: string; // short, funny, first person: "everyone said tacos so i said tacos"
}

export interface RevealPayload {
  aiPlayerId: PlayerId;
  humansWon: boolean;
  finalVoteCounts: Record<PlayerId, number>;
  /** Humans only. aiPersona.name holds the AI's game-assigned nickname. */
  realNames: Record<PlayerId, string>;
  aiPersona: { name: string; blurb: string };
  aiNotes: AiNoteView[]; // at most ~6, already curated
  /** Humans who voted for the AI, and in which rounds (3 = final vote). */
  suspectedBy: { playerId: PlayerId; rounds: RoundNumber[] }[];
  /** Humans who vouched for the AI in round 3. */
  vouchedForAi: PlayerId[];
  /** The human with the most votes summed across all three votes. */
  mostSuspiciousHuman: { playerId: PlayerId; totalVotes: number } | null;
}

export interface PartnerCard {
  /** "partner": you had at least one human partner. "aiPartner": your only partner was the AI. */
  kind: "partner" | "aiPartner";
  partners: {
    playerId: PlayerId;
    nickname: string;
    realName: string;
    collabResult: string | null;
  }[];
  myCollabResult: string | null;
  aiWasInMyPair: boolean;
  /** Who to go talk to instead, for players whose partner was the AI. */
  suggestion: { playerId: PlayerId; realName: string; reason: string } | null;
}

export interface MeView {
  id: PlayerId;
  realName: string;
  nickname: string | null; // null in lobby
  emoji: string | null;
  isHost: boolean; // only ever shown to the host themself
  myAnswer: string | null; // current round
  myVote: PlayerId | null; // current vote phase
  myPairId: PairId | null;
  myCollabResult: string | null;
  myVouches: Record<PlayerId, boolean>;
  partnerCard: PartnerCard | null; // "partners" phase only
}

export interface CurrentRound {
  number: RoundNumber;
  tier: Tier;
  promptId: string;
  prompt: string;
  /** Round 3 only: what each partner submits, e.g. "One thing you two have in common". */
  submitPrompt: string | null;
}

/**
 * The single state object the server sends to each client ("room:state").
 * Clients render purely from this. Spectators (big screen) get me === null.
 */
export interface RoomView {
  code: RoomCode;
  serverNow: number; // for clock-offset correction of countdowns
  phase: Phase;
  phaseEndsAt: number | null; // server time; null = waits for host
  me: MeView | null;
  lobby: { realNames: string[]; minHumans: number; maxHumans: number } | null; // lobby only
  players: PublicPlayer[]; // [] in lobby; humans + AI after start, shuffled
  round: CurrentRound | null;
  history: RoundRecord[]; // includes the current round's record
  answerProgress: { answered: number; total: number } | null; // "answer" phase
  /** Group messages, plus (for players) their own pair's messages. Spectators get group only. */
  messages: ChatMessage[];
  voteProgress: { voted: number; total: number } | null; // "vote" / "finalVote"
  lastVoteCounts: Record<PlayerId, number> | null; // "voteResult"
  pairs: Pair[] | null; // from "pairChat" on
  collabResults: Record<PlayerId, string | null> | null; // from "pairResults" on
  vouches: Vouch[] | null; // from "finalVote" on
  reveal: RevealPayload | null; // "reveal" and "partners"
}
