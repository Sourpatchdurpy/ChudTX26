// ─────────────────────────────────────────────────────────────────────────────
// SHARED CONTRACT: tunable game constants. Owner: Part 3.
// The server may override timers from env vars for playtests (see .env.example).
// ─────────────────────────────────────────────────────────────────────────────

import type { Phase } from "./types";

/** Phase lengths in ms. null = no timer (host advances). Tune these at playtests. */
export const DEFAULT_TIMERS: Record<Phase, number | null> = {
  lobby: null,
  // answer/discuss/vote/finalVote match the arcade UI's built-in countdowns (35s / 50s / 20s).
  answer: 35_000,
  discuss: 50_000,
  vote: 20_000,
  voteResult: 6_000,
  pairChat: 90_000,
  pairResults: 20_000,
  finalVote: 20_000,
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

/**
 * Arcade codenames. A player may pick one on the entry screen (room:create / room:join
 * `codename`, rerollable); everyone else, and always the AI, gets a random unused one when
 * the game starts, so the AI's codename looks like anyone's. Play again re-randomizes all
 * of them (otherwise the one new codename in game 2 would be the AI).
 * Needs at least LIMITS.maxHumans + 1 entries.
 */
export const NICKNAMES: readonly { nickname: string; emoji: string }[] = [
  { nickname: "CYBER_FOX", emoji: "🦊" },
  { nickname: "NEON_VIPER", emoji: "🐍" },
  { nickname: "ECHO_01", emoji: "📡" },
  { nickname: "GHOST_BYTE", emoji: "👻" },
  { nickname: "CIPHER_99", emoji: "🔐" },
  { nickname: "PIXEL_PANDA", emoji: "🐼" },
  { nickname: "TURBO_OWL", emoji: "🦉" },
  { nickname: "LASER_SHARK", emoji: "🦈" },
  { nickname: "NOVA_BEE", emoji: "🐝" },
  { nickname: "GLITCH_FROG", emoji: "🐸" },
  { nickname: "ROCKET_OTTER", emoji: "🦦" },
  { nickname: "CHROME_TIGER", emoji: "🐯" },
  { nickname: "STATIC_OCTO", emoji: "🐙" },
  { nickname: "BYTE_BUNNY", emoji: "🐰" },
  { nickname: "MEGA_SLOTH", emoji: "🦥" },
  { nickname: "VOLT_KOALA", emoji: "🐨" },
];
