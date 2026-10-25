import { LIMITS } from "@game/shared";
import type { AiMode, MuseCall } from "@game/shared";
import { buildRequest } from "../prompts.js";
import { humanize } from "../humanize.js";
import { fallbackText } from "../fallbacks.js";
import { outputSchema, schemaError } from "../schemas.js";
import { validateOutput, validatePerspective } from "../validate.js";
import type { PlayerTurnContext } from "../types.js";
import { abortable, throwIfAborted } from "./abort.js";

export interface TurnResult { action:"send"|"skip";text:string;note:string;fallback:boolean;regenerations:number;raw?:unknown;attemptResults?:{raw:unknown;error?:string}[] }
export function validateStructuredOutput(value:unknown,mode:AiMode,ctx:PlayerTurnContext):TurnResult {
  const error=schemaError(value,outputSchema(mode));if(error)throw new Error(error);
  const obj=value as Record<string,string>;
  if(obj.action==="skip") {
    if(obj.message!==""||ctx.addressedToMe)throw new Error("invalid skip");
    return {action:"skip",text:"",note:obj.note!,fallback:false,regenerations:0,raw:value};
  }
  const raw=obj[mode==="answer"?"answer":mode==="collab"?"result":"message"]!;
  const before=validateOutput(raw);if(!before.ok)throw new Error(before.reason);
  const perspective=validatePerspective(raw,ctx);if(!perspective.ok)throw new Error(perspective.reason);
  const text=humanize(raw,ctx.style,ctx.persona),valid=validateOutput(text);
  const limit=mode==="answer"?LIMITS.answerMaxChars:mode==="collab"?LIMITS.collabMaxChars:LIMITS.chatMaxChars;
  if(!valid.ok||text.length>limit)throw new Error(valid.ok?"mode character limit":valid.reason);
  return {action:"send",text,note:obj.note!,fallback:false,regenerations:0,raw:value};
}
export function safeFallback(ctx:PlayerTurnContext):TurnResult {
  const text=humanize(fallbackText(ctx.mode,ctx),ctx.style,ctx.persona);
  const field=ctx.mode==="answer"?"answer":ctx.mode==="collab"?"result":"message";
  try {
    return {...validateStructuredOutput({...(["group","pair"].includes(ctx.mode)?{action:"send"}:{}),[field]:text,note:"I kept it simple when my reply wasn't ready"},ctx.mode,ctx),fallback:true};
  } catch {return {action:"send",text:ctx.mode==="collab"?"still figuring it out":"still thinking about that",note:"I kept it brief",fallback:true,regenerations:0};}
}
export async function generateTurn(ctx:PlayerTurnContext,call:MuseCall,signal:AbortSignal,cutoff:number):Promise<TurnResult> {
  let invocations=0;
  const attemptResults:{raw:unknown;error?:string}[]=[];
  for(let invocation=0;invocation<2;invocation++) {
    throwIfAborted(signal);
    if(cutoff-Date.now()<(invocation?1000:1))break;
    try {
      const req=buildRequest({...ctx,generationCutoffAt:cutoff,nowMs:Date.now()},ctx.mode);
      invocations++;
      const result=await abortable(call<unknown>(req,{signal,deadlineAtMs:cutoff,label:`${ctx.view.code}:${ctx.mode}`}),signal);
      try {
        const valid=validateStructuredOutput(result,ctx.mode,ctx);
        attemptResults.push({raw:result});return {...valid,regenerations:invocation,attemptResults};
      }catch(error){attemptResults.push({raw:result,error:error instanceof Error?error.message:"invalid structured output"});}
    } catch {throwIfAborted(signal);break;}
  }
  return {...safeFallback(ctx),regenerations:Math.max(0,invocations-1),attemptResults};
}
