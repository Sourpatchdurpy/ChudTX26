// Wires Part 2's humanness layer (root ai/, PART_2_DESIGN.md) and the Muse client
// into the controller. This is the only controller file that imports Part 2 at runtime.
import {
  FALLBACK_LINES,
  buildAnswerRequest,
  buildCollabRequest,
  buildGroupChatRequest,
  buildPairChatRequest,
  computeStyleProfile,
  createSessionMemory,
  disposeSessionMemory,
  inferWritingStyle,
  recordAcceptedOutput,
  updateSessionMemory,
  validateStructuredOutput,
} from "@game/ai";
import type { CreateAiPlayer } from "@game/shared";
import { logRoomMuseStats, museCall } from "../muse.js";
import { AiController } from "./AiController.js";

export const createAiPlayer: CreateAiPlayer = (init) =>
  new AiController(init, {
    humanness: {
      buildAnswerRequest,
      buildGroupChatRequest,
      buildPairChatRequest,
      buildCollabRequest,
      computeStyleProfile,
      inferWritingStyle,
      validateStructuredOutput,
      FALLBACK_LINES,
      createSessionMemory,
      updateSessionMemory,
      recordAcceptedOutput,
      disposeSessionMemory,
    },
    call: museCall,
    logRoomStats: logRoomMuseStats,
  });
