// Part 4's AI runtime. The server imports this module only when AI_MODE=muse;
// otherwise it uses ../game/stubAi.js, which exports the same three names.
export { createAiPlayer } from "./controller/createAiPlayer.js";
export { prepareAiPersona } from "./world/prepareAiPersona.js";
export { runMatchmaker } from "./matchmaker/runMatchmaker.js";
