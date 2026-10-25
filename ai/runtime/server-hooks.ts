import type { FirstQuestionAnswerSnapshot, GameEvent, Persona, PublicPlayer, RoomView, MuseCall, WorldContext } from "@game/shared";
import { generatePersona } from "../persona.js";
import { fallbackPersona } from "../fallback-personas.js";
import { validateFirstSnapshot } from "../examples.js";

/** Called internally AFTER accepted server mutations, never from socket payloads.
 * The caller supplies the authoritative map and fixed shuffled start roster.
 * The only sink is the AI's internal onEvent path, never a broadcaster.
 */
export function createFirstQuestionNotifier(sessionGeneration:string,roster:PublicPlayer[],aiId:string,notify:(event:GameEvent)=>void) {
  const humans=structuredClone(roster.filter(p=>p.id!==aiId));let revision=-1,closed=false;
  return {
    publish(view:RoomView,acceptedAnswers:ReadonlyMap<string,string>):FirstQuestionAnswerSnapshot|null {
      if(closed||view.phase!=="answer"||view.round?.number!==1)return null;
      const answers=humans.filter(p=>acceptedAnswers.has(p.id)).map(p=>({playerId:p.id,nickname:p.nickname,text:acceptedAnswers.get(p.id)!}));
      const snapshot:FirstQuestionAnswerSnapshot={sessionGeneration,round:1,promptId:view.round.promptId,question:view.round.prompt,revision:++revision,
        humanPlayerIds:humans.map(p=>p.id),submittedCount:answers.length,answers};
      validateFirstSnapshot(snapshot,view,aiId,sessionGeneration);
      notify({type:"firstQuestionAnswersUpdated",snapshot:structuredClone(snapshot)});return snapshot;
    },
    dispose(){closed=true;}
  };
}

/** Server readiness boundary. A fresh instance is required for every game.
 * The injected synchronous supplier is frozen at the deadline; late preparation
 * cannot replace it. World context is supplied by the caller; no search is added.
 */
export function preparePersonaWithDeadline(options:{world:WorldContext;call:MuseCall;deadlineAtMs:number;signal?:AbortSignal;fallback?:()=>Persona}):Promise<Persona> {
  const scope=new AbortController();const supplier=options.fallback??fallbackPersona;
  return new Promise(resolve=>{
    let settled=false;
    const finish=(persona?:Persona)=>{
      if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener("abort",cancel);scope.abort();
      const selected=structuredClone(persona??supplier());
      Object.freeze(selected.interests);Object.freeze(selected.facts);Object.freeze(selected.opinions);Object.freeze(selected.thisWeek);Object.freeze(selected.style);Object.freeze(selected);
      resolve(selected);
    };
    const cancel=()=>finish();
    const timer=setTimeout(cancel,Math.max(0,options.deadlineAtMs-Date.now()));
    options.signal?.addEventListener("abort",cancel,{once:true});
    if(options.signal?.aborted||options.deadlineAtMs<=Date.now()){finish();return;}
    const bound:MuseCall=(req,opts={})=>options.call(req,{...opts,signal:scope.signal,deadlineAtMs:options.deadlineAtMs});
    void generatePersona(options.world,bound).then(p=>{if(Date.now()<options.deadlineAtMs)finish(p);else finish();},()=>finish());
  });
}
