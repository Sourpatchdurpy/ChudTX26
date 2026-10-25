// What the controller needs from the outside world. Kept as an interface so the
// controller never imports Part 2's module at runtime (createAiPlayer.ts wires
// the real one from root ai/) and tests can pass fakes.
import type * as Part2 from "@game/ai";
import type { MuseCallFn } from "../muse.js";

/** Part 2's exports the controller calls (docs/PART_2_DESIGN.md §3.1). */
type Builders = Pick<
  typeof Part2,
  | "buildAnswerRequest"
  | "buildGroupChatRequest"
  | "buildPairChatRequest"
  | "buildCollabRequest"
  | "computeStyleProfile"
  | "humanize"
  | "validateOutput"
  | "FALLBACK_LINES"
>;

/** Part 2's per-game memory (§2.3, §3.8). Optional: the builders derive it from the view when absent. */
type MemoryHelpers = Pick<
  typeof Part2,
  "createSessionMemory" | "updateSessionMemory" | "recordAcceptedOutput" | "disposeSessionMemory"
>;

export type HumannessDeps = Builders & Partial<MemoryHelpers>;
export type SessionMemory = Part2.SessionMemory;
export type PlayerTurnContext = Part2.PlayerTurnContext;

export interface ControllerDeps {
  humanness: HumannessDeps;
  call: MuseCallFn;
  /** Defaults to Math.random. Tests pass a seeded PRNG. */
  random?: () => number;
  /** Called from dispose() to print this game's Muse usage summary. */
  logRoomStats?: (roomCode: string) => void;
}
