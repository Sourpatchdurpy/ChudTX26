import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AiMode, MuseCall } from "@game/shared";
import { fixture } from "../fixtures/scenarios.js";
import { buildRequest } from "../prompts.js";
import { generateTurn } from "../runtime/pipeline.js";
import { museFromEnvironment } from "../runtime/muse.js";
import type { MuseMetric } from "../runtime/muse.js";
import { BASELINE_POLICY } from "../generation-policy.js";
import type { TierName } from "../types.js";
import { validateOutput } from "../validate.js";

const args=process.argv.slice(2);
const arg=(name:string,defaultValue:string)=>{const i=args.indexOf(name);return i<0?defaultValue:args[i+1]??"";};
const n=Number(arg("--n","3")),name=arg("--fixture","accused-1"),live=args.includes("--live"),tier=arg("--tier","baseline") as TierName;
if(!Number.isInteger(n)||n<1||n>10000)throw new Error("--n must be a positive integer at most 10000");
if(!["baseline","expanded","complex","high"].includes(tier))throw new Error("invalid --tier");
const plannedMaxCalls=n*4;
console.log(JSON.stringify({mode:live?"LIVE":"mocked",runs:n,normalCalls:n,maxProviderAttempts:plannedMaxCalls,regenerationAllowance:n,estimatedMaximumCostUsd:plannedMaxCalls*0.025}));
if(live&&plannedMaxCalls>10&&!args.includes("--yes"))throw new Error("More than ten possible calls require --yes. Human approval is separately required for agent-run live evaluations.");
if(live&&tier!=="baseline"&&!args.includes("--approved-tier"))throw new Error("Higher live tiers require an approved and evaluated policy; --approved-tier records the operator assertion.");
const ctx=fixture(name),requestedMode=arg("--mode",ctx.mode);
if(!["answer","group","pair","collab"].includes(requestedMode))throw new Error("invalid --mode");
ctx.mode=requestedMode as AiMode;
if(tier!=="baseline")ctx.generationPolicy={...BASELINE_POLICY,approved:["baseline",tier],evaluated:["baseline",tier]};
const metrics:MuseMetric[]=[];
const liveCall=live?museFromEnvironment(m=>metrics.push(m)):undefined;
const artifacts:unknown[]=[];
for(let i=0;i<n;i++) {
  const scope=new AbortController(),cutoff=Date.now()+20000,timer=setTimeout(()=>scope.abort(),20000);
  const assemblyStart=performance.now(),request=buildRequest(ctx,ctx.mode),assemblyMs=performance.now()-assemblyStart;
  const call:MuseCall=liveCall??(async<T>()=>{
    if(name==="api-failure")throw new Error("synthetic API failure");
    if(name==="invalid-structured-output")return {wrong:"synthetic malformed object"} as T;
    return (ctx.mode==="answer"?{answer:"potato and egg tacos",note:"I stuck with my usual order"}:ctx.mode==="collab"?{result:"we haven't settled on one yet",note:"I didn't invent an agreement"}:
      {action:"send",message:"what gave you that idea",note:"I answered the accusation briefly"}) as T;
  });
  const started=performance.now();
  try {
    const result=await generateTurn(ctx,call,scope.signal,cutoff);
    const context=JSON.parse(request.messages[1]!.content) as unknown;
    artifacts.push({fixture:name,source:"synthetic-developer",transport:live?"live":"mock",request,context,memory:{...ctx.memory,processedMessageIds:[...(ctx.memory?.processedMessageIds??[])],visibleAnswerKeys:[...(ctx.memory?.visibleAnswerKeys??[])]},
      result,validation:result.action==="skip"?{ok:true}:validateOutput(result.text),assemblyMs,generationAndValidationMs:performance.now()-started,metrics:metrics.splice(0)});
    console.log(JSON.stringify({run:i+1,raw:result.raw??result.attemptResults,text:result.text,validation:result.action==="skip"?{ok:true}:validateOutput(result.text),fallback:result.fallback,regenerations:result.regenerations}));
  }finally{clearTimeout(timer);scope.abort();}
}
const dir=new URL("../fixtures/outputs/",import.meta.url);await mkdir(dir,{recursive:true});
const path=new URL(`${name}-${Date.now()}.json`,dir);
await writeFile(path,JSON.stringify(artifacts,null,2));console.log(`Saved ${fileURLToPath(path)}`);
