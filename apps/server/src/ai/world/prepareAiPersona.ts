// The real PrepareAiPersona export: cached world context + Part 2's persona generator.
// ai/index.ts re-exports this as `prepareAiPersona`.
import type { PrepareAiPersona } from "@game/shared";
import { museCallFor } from "../muse.js";
import { fallbackPersona, generatePersona } from "../player/index.js";
import { makePrepareAiPersona } from "./persona.js";
import { getWorldContext } from "./worldContext.js";

export const prepareAiPersona: PrepareAiPersona = makePrepareAiPersona({
  getWorldContext,
  generatePersona,
  fallbackPersona,
  callFor: museCallFor,
});
