// The real PrepareAiPersona export: cached world context + Part 2's persona generator.
// ai/index.ts re-exports this as `prepareAiPersona`.
import { fallbackPersona, generatePersona } from "@game/ai";
import type { MuseCall, PrepareAiPersona } from "@game/shared";
import { museCallFor } from "../muse.js";
import { makePrepareAiPersona } from "./persona.js";
import { getWorldContext } from "./worldContext.js";

/** Label persona calls "persona" (logs, and muse.ts's larger token allowance for them). */
const personaCallFor = (roomCode: string, signal?: AbortSignal): MuseCall => {
  const call = museCallFor(roomCode, signal);
  return (req, opts) => call(req, { label: "persona", ...opts });
};

export const prepareAiPersona: PrepareAiPersona = makePrepareAiPersona({
  getWorldContext,
  generatePersona,
  fallbackPersona,
  callFor: personaCallFor,
});
