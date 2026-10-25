import { LIMITS } from "@game/shared";
import type { AiMode, MuseCall } from "@game/shared";
import { buildRequest } from "../prompts.js";
import { humanize } from "../humanize.js";
import { fallbackText } from "../fallbacks.js";
import { outputSchema, schemaError } from "../schemas.js";
import { validateOutput, validatePerspective } from "../validate.js";
import type { PlayerTurnContext } from "../types.js";
import { abortable, throwIfAborted } from "./abort.js";
import { inferWritingStyle } from "../writing-style.js";
import { repeatedExpression } from "../expression-variety.js";
import { isEmptyDefense, isLowValueChat, isResolvedChat } from "../chat-policy.js";

export interface TurnResult { action:"send"|"skip";text:string;note:string;fallback:boolean;regenerations:number;raw?:unknown;attemptResults?:{raw:unknown;error?:string}[] }
export function validateStructuredOutput(value:unknown,mode:AiMode,ctx:PlayerTurnContext):TurnResult {
  const error=schemaError(value,outputSchema(mode));if(error)throw new Error(error);
  const obj=value as Record<string,string>;
  if(obj.action==="skip") {
    const courtesy=ctx.trigger.kind==="message"&&isLowValueChat(ctx.trigger.message.text,ctx.myNickname,mode==="group");
    const resolved=ctx.trigger.kind==="message"&&isResolvedChat(ctx.trigger.message,ctx.view.messages,ctx.myNickname);
    if(obj.message!==""||(ctx.addressedToMe&&!courtesy&&!resolved))throw new Error("invalid skip");
    return {action:"skip",text:"",note:obj.note!,fallback:false,regenerations:0,raw:value};
  }
  const raw=obj[mode==="answer"?"answer":mode==="collab"?"result":"message"]!;
  if((mode==="group"||mode==="pair")&&ctx.addressedToMe&&ctx.trigger.kind==="message"&&/\b(?:bot|ai|robot(?:ic)?|sus|fake|you said|earlier|contradict\w*)\b/iu.test(ctx.trigger.message.text)&&isEmptyDefense(raw))throw new Error("generic denial or deflection; address the specific accusation using established facts");
  if((mode==="group"||mode==="pair")&&isLowValueChat(raw,ctx.myNickname,mode==="group")) {
    if(ctx.addressedToMe)throw new Error("empty acknowledgement; answer the actual question or accusation directly");
    return {action:"skip",text:"",note:obj.note!,fallback:false,regenerations:0,raw:value};
  }
  const before=validateOutput(raw);if(!before.ok)throw new Error(before.reason);
  const perspective=validatePerspective(raw,ctx);if(!perspective.ok)throw new Error(perspective.reason);
  const repeated=repeatedExpression(raw,ctx);
  if(repeated)throw new Error(`repeated filler expression: ${repeated}; reply directly without this expression`);
  const text=humanize(raw,inferWritingStyle(ctx).style,ctx.persona),valid=validateOutput(text);
  const limit=mode==="answer"?LIMITS.answerMaxChars:mode==="collab"?LIMITS.collabMaxChars:LIMITS.chatMaxChars;
  if(!valid.ok||text.length>limit)throw new Error(valid.ok?"mode character limit":valid.reason);
  return {action:"send",text,note:obj.note!,fallback:false,regenerations:0,raw:value};
}
export function safeFallback(ctx:PlayerTurnContext):TurnResult {
  const field=ctx.mode==="answer"?"answer":ctx.mode==="collab"?"result":"message";
  try {
    const text=humanize(fallbackText(ctx.mode,ctx),inferWritingStyle(ctx).style,ctx.persona);
    return {...validateStructuredOutput({...(["group","pair"].includes(ctx.mode)?{action:"send"}:{}),[field]:text,note:"I kept it simple when my reply wasn't ready"},ctx.mode,ctx),fallback:true};
  } catch {return {action:"send",text:ctx.mode==="collab"?"still figuring it out":"still thinking about that",note:"I kept it brief",fallback:true,regenerations:0};}
}
export async function generateTurn(ctx:PlayerTurnContext,call:MuseCall,signal:AbortSignal,cutoff:number):Promise<TurnResult> {
  let invocations=0;
  const attemptResults:{raw:unknown;error?:string}[]=[];
  let regenerationFeedback:string|undefined;
  for(let invocation=0;invocation<2;invocation++) {
    throwIfAborted(signal);
    if(cutoff-Date.now()<(invocation?1000:1))break;
    try {
      const req=buildRequest({...ctx,regenerationFeedback,generationCutoffAt:cutoff,nowMs:Date.now()},ctx.mode);
      invocations++;
      const result=await abortable(call<unknown>(req,{signal,deadlineAtMs:cutoff,label:`${ctx.view.code}:${ctx.mode}`}),signal);
      try {
        const valid=validateStructuredOutput(result,ctx.mode,ctx);
        attemptResults.push({raw:result});return {...valid,regenerations:invocation,attemptResults};
      }catch(error){regenerationFeedback=error instanceof Error?error.message:"invalid structured output";attemptResults.push({raw:result,error:regenerationFeedback});}
    } catch {throwIfAborted(signal);break;}
  }
  return {...safeFallback(ctx),regenerations:Math.max(0,invocations-1),attemptResults};
}
