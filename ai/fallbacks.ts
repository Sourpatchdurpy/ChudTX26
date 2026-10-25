import type { AiMode } from "@game/shared";
import type { PlayerTurnContext } from "./types.js";

export const FALLBACK_LINES={answer:{light:["probably something salty","i keep it pretty simple","depends on the day"],personal:["i take a while to warm up","i usually need a little time to think","i try to keep things low key"]},
  collab:["we haven't settled on one yet","still comparing our answers"],group:["wait what","yeah fair","i can see that"],accused:["me??","what gave you that idea","i don't see it"],pair:["what do you think?","still thinking about that","yeah tell me more"]};
export function fallbackText(mode:AiMode,ctx:PlayerTurnContext):string {
  if(mode==="answer") {
    const q=ctx.view.round?.prompt.toLowerCase()??"";
    if(/food|order|meal|eat/u.test(q))return ctx.persona.facts.find(f=>/favorite order|usual order/iu.test(f))??"depends what i'm craving";
    if(/hobb|free time|weekend/u.test(q))return ctx.persona.interests[0]??"usually something quiet";
    if(/opinion|take/u.test(q))return ctx.persona.opinions[0]??"i like keeping things simple";
    return FALLBACK_LINES.answer[ctx.view.round?.tier==="personal"?"personal":"light"][0]!;
  }
  return FALLBACK_LINES[mode==="collab"?"collab":mode][0]!;
}
