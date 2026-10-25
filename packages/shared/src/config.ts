// ─────────────────────────────────────────────────────────────────────────────
// SHARED CONTRACT: tunable game constants. Owner: Part 3.
// The server may override timers from env vars for playtests (see .env.example).
// ─────────────────────────────────────────────────────────────────────────────

import type { Phase } from "./types";

/** Phase lengths in ms. null = no timer (host advances). Tune these at playtests. */
export const DEFAULT_TIMERS: Record<Phase, number | null> = {
  lobby: null,
  answer: 30_000,
  discuss: 45_000,
  vote: 12_000,
  voteResult: 6_000,
  pairChat: 90_000,
  pairResults: 20_000,
  finalVote: 15_000,
  reveal: null,
  partners: null,
};

/** Every chat message (group and pair) is held this long before anyone sees it. Hides AI latency. */
export const CHAT_DELAY_MS = 5_000;

/** Extra random wait the AI adds on top of its human-like typing time (ms range). */
export const AI_EXTRA_JITTER_MS: readonly [number, number] = [0, 4_000];

export const LIMITS = {
  minHumans: 3,
  maxHumans: 6,
  realNameMaxChars: 20,
  answerMaxChars: 280,
  chatMaxChars: 200,
  collabMaxChars: 140,
} as const;

/** Rooms are deleted after this much inactivity. Nothing is persisted. */
export const ROOM_TTL_MS = 30 * 60_000;

/** No I or O, to avoid confusion with 1 and 0. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

/** Nicknames are shuffled and assigned to every player (AI included) when the game starts. */
export const NICKNAMES: readonly { nickname: string; emoji: string }[] = [
  { nickname: "Fox", emoji: "🦊" },
  { nickname: "Owl", emoji: "🦉" },
  { nickname: "Otter", emoji: "🦦" },
  { nickname: "Panda", emoji: "🐼" },
  { nickname: "Koala", emoji: "🐨" },
  { nickname: "Tiger", emoji: "🐯" },
  { nickname: "Frog", emoji: "🐸" },
  { nickname: "Penguin", emoji: "🐧" },
  { nickname: "Octopus", emoji: "🐙" },
  { nickname: "Bee", emoji: "🐝" },
  { nickname: "Sloth", emoji: "🦥" },
  { nickname: "Hedgehog", emoji: "🦔" },
];
