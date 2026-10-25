// Wires Part 2's humanness layer and the Muse client into the controller.
// This is the only controller file that imports ../player/ at runtime.
import type { CreateAiPlayer } from "@game/shared";
import { logRoomMuseStats, museCall } from "../muse.js";
import {
  FALLBACK_LINES,
  buildAnswerRequest,
  buildCollabRequest,
  buildGroupChatRequest,
  buildPairChatRequest,
  computeStyleProfile,
  humanize,
  validateOutput,
} from "../player/index.js";
import { AiController } from "./AiController.js";

export const createAiPlayer: CreateAiPlayer = (init) =>
  new AiController(init, {
    humanness: {
      buildAnswerRequest,
      buildGroupChatRequest,
      buildPairChatRequest,
      buildCollabRequest,
      computeStyleProfile,
      humanize,
      validateOutput,
      FALLBACK_LINES,
    },
    call: museCall,
    logRoomStats: logRoomMuseStats,
  });
