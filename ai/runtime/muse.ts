import OpenAI from "openai";
import type { MuseCall, MuseChatRequest } from "@game/shared";
import { abortable, backoff, throwIfAborted } from "./abort.js";

export interface ProviderResponse {
  choices: {message:{content:string|null}}[];
  usage?: {prompt_tokens:number;completion_tokens:number;prompt_tokens_details?:{cached_tokens?:number};completion_tokens_details?:{reasoning_tokens?:number}};
}
export interface MuseMetric {
  label:string;attempt:number;latencyMs:number;inputTokens:number;outputTokens:number;cachedTokens:number;reasoningTokens:number;
  estimatedCostUsd:number;totalEstimatedCostUsd:number;reasoning:string;completionAllowance:number;status:"ok"|"error";
}
export interface MuseOptions {
  apiKey?:string;model?:string;timeoutMs?:number;maxCallsPerMinute?:number;
  /** null explicitly disables the monetary cutoff; token/spend reports continue. */
  budgetUsd?:number|null;onMetric?:(metric:MuseMetric)=>void;
  send?:(request:MuseChatRequest,signal:AbortSignal)=>Promise<ProviderResponse>;
}
export function createMuseCall(options:MuseOptions={}):MuseCall {
  const model=options.model??"muse-spark-1.3";
  if(model.toLowerCase().includes("contributor"))throw new Error("contributor models are prohibited");
  const timeoutMs=options.timeoutMs??12000, cap=options.maxCallsPerMinute??60, budget=options.budgetUsd??null;
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isInteger(cap)||cap<1||(budget!==null&&(!Number.isFinite(budget)||budget<0)))throw new Error("invalid transport configuration");
  let client:OpenAI|undefined, total=0;const starts:number[]=[];
  const send=options.send??(async(req:MuseChatRequest,signal:AbortSignal)=>{
    client??=new OpenAI({baseURL:"https://api.meta.ai/v1",apiKey:options.apiKey,maxRetries:0});
    return await client.chat.completions.create({model,...req,stream:false},{signal}) as ProviderResponse;
  });
  return async<T>(req:MuseChatRequest,opts:NonNullable<Parameters<MuseCall>[1]>={}):Promise<T>=>{
    throwIfAborted(opts.signal);
    if(opts.deadlineAtMs!==undefined&&!Number.isFinite(opts.deadlineAtMs))throw new Error("invalid absolute cutoff");
    if(opts.timeoutMs!==undefined&&(!Number.isFinite(opts.timeoutMs)||opts.timeoutMs<=0))throw new Error("invalid attempt timeout");
    const deadline=opts.deadlineAtMs??Infinity;
    const overall=new AbortController();
    const cancel=()=>overall.abort();opts.signal?.addEventListener("abort",cancel,{once:true});
    const cutoff=Number.isFinite(deadline)?setTimeout(cancel,Math.max(0,deadline-Date.now())):undefined;
    try {
      for(let attempt=1;attempt<=2;attempt++) {
        throwIfAborted(overall.signal);
        const remaining=deadline-Date.now();
        if(remaining<=0||(attempt>1&&remaining<1000))throw new Error("generation cutoff reached");
        while(starts.length&&starts[0]!<Date.now()-60000)starts.shift();
        if(starts.length>=cap)throw new Error("Muse rate cap reached");
        if(budget!==null&&total>=budget)throw new Error("Muse monetary cutoff reached");
        const scope=new AbortController(), abortAttempt=()=>scope.abort();
        overall.signal.addEventListener("abort",abortAttempt,{once:true});
        let timedOut=false;
        const timer=setTimeout(()=>{timedOut=true;scope.abort();},Math.min(opts.timeoutMs??timeoutMs,remaining));
        const started=Date.now();starts.push(started);
        let usage:ProviderResponse["usage"], successful=false,finished=started;
        try {
          const response=await abortable(send(req,scope.signal),scope.signal);usage=response.usage;
          const content=response.choices[0]?.message.content;
          if(typeof content!=="string")throw new Error("missing structured response");
          const parsed:unknown=JSON.parse(content);successful=true;finished=Date.now();return parsed as T;
        } catch(error) {
          finished=Date.now();clearTimeout(timer);
          throwIfAborted(overall.signal);
          const status=typeof error==="object"&&error!==null&&"status" in error?Number(error.status):0;
          const retry=timedOut||status===429||status>=500&&status<=599;
          if(attempt===2||!retry||deadline-Date.now()<1100)throw error;
          await backoff(100,overall.signal);
        } finally {
          clearTimeout(timer);overall.signal.removeEventListener("abort",abortAttempt);
          const input=usage?.prompt_tokens??0,output=usage?.completion_tokens??0,cached=Math.min(input,usage?.prompt_tokens_details?.cached_tokens??0);
          const cost=((input-cached)*1.25+cached*0.15+output*4.25)/1e6;total+=cost;
          try{options.onMetric?.({label:opts.label??"player",attempt,latencyMs:finished-started,inputTokens:input,outputTokens:output,cachedTokens:cached,reasoningTokens:usage?.completion_tokens_details?.reasoning_tokens??0,
            estimatedCostUsd:cost,totalEstimatedCostUsd:total,reasoning:req.reasoning_effort??"minimal",completionAllowance:req.max_completion_tokens??800,status:successful?"ok":"error"});}catch{/* reporting cannot retry or discard a successful response */}
        }
      }
      throw new Error("Muse attempts exhausted");
    } finally {clearTimeout(cutoff);opts.signal?.removeEventListener("abort",cancel);}
  };
}
/** Explicit environment construction: importing this module never calls a provider. */
export function museFromEnvironment(onMetric?:MuseOptions["onMetric"]):MuseCall {
  const value=process.env.MUSE_BUDGET_USD;
  return createMuseCall({apiKey:process.env.MODEL_API_KEY,model:process.env.MUSE_MODEL,timeoutMs:Number(process.env.MUSE_TIMEOUT_MS??12000),
    maxCallsPerMinute:Number(process.env.MUSE_MAX_CALLS_PER_MIN??60),budgetUsd:value===undefined||value==="disabled"?null:Number(value),onMetric});
}
