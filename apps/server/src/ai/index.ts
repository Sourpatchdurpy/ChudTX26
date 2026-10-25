// Part 4's AI runtime. The server imports this module only when AI_MODE=muse;
// otherwise it uses ../game/stubAi.js, which exports the same names.
export { createAiPlayer } from "./controller/createAiPlayer.js";
export { prepareAiPersona } from "./world/prepareAiPersona.js";
export { runMatchmaker } from "./matchmaker/runMatchmaker.js";
/** Part 2's synchronous persona, used if preparation misses the server's readiness deadline. */
export { fallbackPersona } from "@game/ai";
