import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { AiActions, AiPlayerInit, MuseCall, MuseChatRequest } from "@game/shared";
import { createMuseCall } from "../runtime/muse.js";
import type { MuseMetric, ProviderResponse } from "../runtime/muse.js";
import { generateTurn,validateStructuredOutput } from "../runtime/pipeline.js";
import { createAiPlayer } from "../runtime/controller.js";
import { createFirstQuestionNotifier,preparePersonaWithDeadline } from "../runtime/server-hooks.js";
import { fixture,firstSnapshot,roomView,message,roster } from "../fixtures/scenarios.js";
import { fallbackPersonaSamples } from "../fallback-personas.js";
import { humanize } from "../humanize.js";
import { validateOutput } from "../validate.js";

const response=(value:unknown):ProviderResponse=>({choices:[{message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:40},completion_tokens_details:{reasoning_tokens:5}}});
const req={messages:[{role:"user" as const,content:"synthetic"}],reasoning_effort:"minimal" as const,max_completion_tokens:800};
const http=(status:number)=>Object.assign(new Error("synthetic provider failure"),{status});
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const flush=()=>delay(5);

test("transport parses once and records metadata without chat",async()=>{
  const metrics:MuseMetric[]=[];const call=createMuseCall({send:async()=>response({answer:"hello",note:"I kept it short"}),onMetric:m=>metrics.push(m)});
  const out=await call<{answer:string}>(req);assert.equal(out.answer,"hello");assert.equal(metrics.length,1);assert.equal(metrics[0]!.cachedTokens,40);
  assert.equal(metrics[0]!.reasoningTokens,5);assert.ok(metrics[0]!.estimatedCostUsd>0);assert.equal(JSON.stringify(metrics).includes("hello"),false);
});
test("400/401/402/403 and malformed JSON never get transport retries",async()=>{
  for(const status of [400,401,402,403]){let n=0;const call=createMuseCall({send:async()=>{n++;throw http(status);}});await assert.rejects(call(req));assert.equal(n,1);}
  let n=0;const call=createMuseCall({send:async()=>{n++;return {choices:[{message:{content:"not json"}}]};}});await assert.rejects(call(req));assert.equal(n,1);
});
test("one transport retry on 429 and 5xx; rate cap and monetary configuration remain explicit",async()=>{
  for(const status of [429,500]){let n=0;const call=createMuseCall({send:async()=>{if(++n===1)throw http(status);return response({ok:true});}});assert.deepEqual(await call(req),{ok:true});assert.equal(n,2);}
  let n=0;const limited=createMuseCall({maxCallsPerMinute:1,send:async()=>{n++;return response({ok:true});}});await limited(req);await assert.rejects(limited(req),/rate cap/);assert.equal(n,1);
  const capped=createMuseCall({budgetUsd:0,send:async()=>{throw new Error("should not send");}});await assert.rejects(capped(req),/monetary/);
  const unlimited=createMuseCall({budgetUsd:null,send:async()=>response({ok:true})});await unlimited(req);await unlimited(req);
  assert.throws(()=>createMuseCall({model:"muse-spark-1.3-contributor"}),/contributor/);
});
test("caller cancellation during retry backoff is terminal",async()=>{
  let n=0;const scope=new AbortController();const call=createMuseCall({send:async()=>{n++;setTimeout(()=>scope.abort(),15);throw http(429);}});
  await assert.rejects(call(req,{signal:scope.signal,deadlineAtMs:Date.now()+3000}),/abort/iu);assert.equal(n,1);
});
test("absolute cutoff aborts an uncooperative client and expired deadlines start no calls",async()=>{
  let n=0;const call=createMuseCall({send:async()=>{n++;return await new Promise<ProviderResponse>(()=>{});}});
  const started=Date.now();await assert.rejects(call(req,{deadlineAtMs:Date.now()+35}),/abort/iu);assert.ok(Date.now()-started<500);assert.equal(n,1);
  await assert.rejects(call(req,{deadlineAtMs:Date.now()-1}));assert.equal(n,1);
});
test("one invalid-output regeneration, four provider attempts maximum",async()=>{
  const ctx=fixture("r1-answer-light");let attempts=0;
  const call=createMuseCall({send:async()=>{attempts++;if(attempts%2)throw http(429);return response({wrong:"field"});}});
  const result=await generateTurn(ctx,call,new AbortController().signal,Date.now()+4000);assert.equal(result.fallback,true);assert.equal(attempts,4);
});
test("structured validators reject strings, extra keys, bad skip, note and mode limits before cleanup",()=>{
  const ctx=fixture("discuss-addressed");
  for(const value of ['{"action":"send","message":"hi","note":"x"}',{action:"send",message:"hi",note:"x",extra:true},{action:"skip",message:"hi",note:"x"},{action:"skip",message:"",note:"x"},
    {action:"send",message:"hi",note:"n".repeat(101)},{action:"send",message:"x".repeat(201),note:"x"},{action:"send",message:"- first\n- second",note:"x"}])assert.throws(()=>validateStructuredOutput(value,"group",ctx));
  assert.equal(validateStructuredOutput({action:"skip",message:"",note:"I waited"},"group",{...ctx,addressedToMe:false}).action,"skip");
});
test("cleanup preserves meaning, proper nouns, I, URLs and entire emoji clusters",()=>{
  const ctx=fixture("discuss-quiet"),style={...ctx.style,lowercaseStartRatio:0.9,endsWithPeriodRatio:0,emojiPerMessage:1};
  assert.equal(humanize("  The bus is late.  ",style,ctx.persona),"the bus is late");assert.equal(humanize("I went home.",style,ctx.persona),"I went home");
  assert.equal(humanize("Mika is here.",style,ctx.persona),"Mika is here");assert.equal(humanize("https://example.com.",style,ctx.persona),"https://example.com.");
  assert.equal(humanize("hi 👩🏽‍💻 🇺🇸",style,ctx.persona),"hi 👩🏽‍💻");assert.equal(validateOutput("I cannot help with that").ok,false);assert.equal(validateOutput("assistant").ok,false);
});

function controllerHarness(call:MuseCall,endsAt=Date.now()+30000) {
  const submitted:string[]=[],errors:string[]=[],chats:string[]=[];
  const actions:AiActions={submitAnswer:text=>{submitted.push(text);return {ok:true};},sendChat:text=>{chats.push(text);return {ok:true,messageId:"chat",visibleAt:Date.now()+5000};},submitCollab:()=>({ok:true}),castVote:()=>({ok:true}),setVouch:()=>({ok:true})};
  const init:AiPlayerInit={sessionGeneration:"test-generation",roomCode:"TEST",aiPlayerId:"ai",persona:fallbackPersonaSamples()[0]!,actions};
  const player=createAiPlayer(init,{call,random:()=>0.99,onError:m=>errors.push(m)}),view=roomView({phaseEndsAt:endsAt});
  return {player,view,submitted,errors,chats};
}
test("first question waits for every human, captures latest resubmission and submits immediately",async()=>{
  let calls=0;const inputs:string[]=[];
  const call:MuseCall=async<T>(request:MuseChatRequest)=>{calls++;inputs.push(request.messages[1]!.content);return {answer:"potato and egg tacos",note:"I used my own order"} as T;};
  const h=controllerHarness(call);try {
    h.player.onEvent({type:"firstQuestionAnswersUpdated",snapshot:firstSnapshot(h.view,"test-generation",0)},h.view);await flush();assert.equal(calls,0);
    const two=firstSnapshot(h.view,"test-generation",2);h.player.onEvent({type:"firstQuestionAnswersUpdated",snapshot:two},h.view);await flush();assert.equal(calls,0);
    const all=firstSnapshot(h.view);all.answers[0]!.text="RESUBMITTED noodles";all.revision=5;
    const start=Date.now();h.player.onEvent({type:"firstQuestionAnswersUpdated",snapshot:all},h.view);await flush();
    assert.equal(calls,1);assert.equal(h.submitted.length,1);assert.ok(Date.now()-start<100);assert.ok(inputs[0]!.includes("RESUBMITTED noodles"));
    h.player.onEvent({type:"firstQuestionAnswersUpdated",snapshot:all},h.view);await flush();assert.equal(calls,1);assert.equal(h.submitted.length,1);
    assert.deepEqual(h.errors,[]);
  }finally{h.player.dispose();}
});
test("private identity, roster, revision and conflicting-repeat validation",async()=>{
  let calls=0;const h=controllerHarness(async<T>()=>{calls++;return {} as T;});try {
    const initial=firstSnapshot(h.view,"test-generation",0);h.player.onEvent({type:"firstQuestionAnswersUpdated",snapshot:initial},h.view);
    const wrong=firstSnapshot(h.view,"other-generation");h.player.onEvent({type:"firstQuestionAnswersUpdated",snapshot:wrong},h.view);
    const conflict=structuredClone(initial);conflict.humanPlayerIds.reverse();h.player.onEvent({type:"firstQuestionAnswersUpdated",snapshot:conflict},h.view);
    assert.ok(h.errors.some(e=>e.includes("mismatch")));assert.ok(h.errors.some(e=>e.includes("conflicting")));assert.equal(calls,0);
  }finally{h.player.dispose();}
});
test("deadline reserve supports incomplete examples and fallback beats late generation",async()=>{
  const pending=deferred<unknown>();let calls=0;
  const call:MuseCall=async<T>()=>{calls++;return await pending.promise as T;};
  const h=controllerHarness(call,Date.now()+3060);try {
    h.player.onEvent({type:"firstQuestionAnswersUpdated",snapshot:firstSnapshot(h.view,"test-generation",1)},h.view);
    await delay(100);assert.equal(calls,1);assert.equal(h.submitted.length,1);
    const accepted=h.submitted[0];pending.resolve({answer:"LATE RESULT",note:"I came in late"});await flush();assert.equal(h.submitted.length,1);assert.equal(h.submitted[0],accepted);
  }finally{h.player.dispose();}
});
test("no private examples at deadline uses fallback; host advancement permits null answer",async()=>{
  const pending=deferred<unknown>();let calls=0;
  const h=controllerHarness(async<T>()=>{calls++;return await pending.promise as T;});try {
    h.player.onEvent({type:"firstQuestionAnswersUpdated",snapshot:firstSnapshot(h.view)},h.view);await flush();assert.equal(calls,1);
    const advanced={...h.view,phase:"discuss" as const};h.player.onEvent({type:"phaseChanged",phase:"discuss",round:1},advanced);
    pending.resolve({answer:"late",note:"I was late"});await flush();assert.equal(h.submitted.length,0);
  }finally{h.player.dispose();}
  const h2=controllerHarness(async<T>()=>({answer:"plain answer",note:"I kept it plain"} as T),Date.now()+3000);
  try{h2.player.onEvent({type:"phaseChanged",phase:"answer",round:1},h2.view);await delay(20);assert.equal(h2.submitted.length,1);}finally{h2.player.dispose();}
});
test("server hooks emit private copied snapshots only; map resubmission replaces text",()=>{
  const events:unknown[]=[],view=roomView(),answers=new Map<string,string>();
  const notifier=createFirstQuestionNotifier("g",roster,"ai",e=>events.push(e));
  const initial=notifier.publish(view,answers)!;assert.equal(initial.revision,0);assert.equal(initial.submittedCount,0);
  answers.set("h1","one");const first=notifier.publish(view,answers)!;answers.set("h1","replacement");const next=notifier.publish(view,answers)!;
  assert.equal(first.answers[0]!.text,"one");assert.equal(next.answers[0]!.text,"replacement");assert.equal(next.submittedCount,1);assert.equal(next.revision,2);
  assert.equal("firstQuestionHumanAnswers" in view,false);assert.equal(JSON.stringify(view).includes("replacement"),false);assert.equal(events.length,3);notifier.dispose();assert.equal(notifier.publish(view,answers),null);
});
test("reveal display name comes from the game nickname, without a persona name field",()=>{
  const h=controllerHarness(async<T>()=>({} as T));
  try {
    h.player.onEvent({type:"stateUpdated"},h.view);
    assert.equal(h.player.getRevealInfo().persona.name,"Fox");
    assert.equal(h.player.getRevealInfo().persona.blurb,fallbackPersonaSamples()[0]!.blurb);
  }finally{h.player.dispose();}
});
test("readiness deadline freezes supplier persona and ignores late preparation",async()=>{
  const pending=deferred<unknown>(),selected=fallbackPersonaSamples()[2]!;let supplierCalls=0;
  const call:MuseCall=async<T>()=>await pending.promise as T;
  const p=await preparePersonaWithDeadline({world:{fetchedAt:Date.now(),trending:[],news:[],local:[],weather:null,hacktx:[]},call,deadlineAtMs:Date.now()+25,fallback:()=>{supplierCalls++;return selected;}});
  assert.equal(p.blurb,selected.blurb);assert.equal("name" in p,false);assert.equal(supplierCalls,1);assert.equal(Object.isFrozen(p),true);assert.equal(Object.isFrozen(p.facts),true);
  pending.resolve({...fallbackPersonaSamples()[0],school:null,year:null,major:null});await flush();assert.equal(p.blurb,selected.blurb);
});
test("dispose aborts in-flight work; new session has a new generation and no memory",async()=>{
  const pending=deferred<unknown>();const h=controllerHarness(async<T>()=>await pending.promise as T);
  h.player.onEvent({type:"firstQuestionAnswersUpdated",snapshot:firstSnapshot(h.view)},h.view);h.player.dispose();pending.resolve({answer:"late",note:"I waited"});await flush();assert.equal(h.submitted.length,0);
});

test("unaddressed stale chat is discarded and reconsidered from the newest visible message",async()=>{
  const first=deferred<unknown>(),second=deferred<unknown>();let calls=0;const sent:string[]=[];
  const player=createAiPlayer({sessionGeneration:"g",roomCode:"TEST",aiPlayerId:"ai",persona:fallbackPersonaSamples()[0]!,actions:{
    submitAnswer:()=>({ok:true}),submitCollab:()=>({ok:true}),castVote:()=>({ok:true}),setVouch:()=>({ok:true}),sendChat:text=>{sent.push(text);return {ok:true,messageId:"sent",visibleAt:Date.now()+5000};}
  }},{random:()=>0,call:async<T>()=>await (++calls===1?first.promise:second.promise) as T});
  try {
    const view=roomView({phase:"discuss",messages:[message("first","hello")]}),initial=view.messages[0]!;
    player.onEvent({type:"messageVisible",message:initial},view);await flush();assert.equal(calls,1);
    for(let i=0;i<3;i++){const next=message(`new${i}`,`new topic ${i}`,"h2");view.messages.push(next);player.onEvent({type:"messageVisible",message:next},view);}
    first.resolve({action:"send",message:"old topic reply",note:"I replied"});await flush();assert.equal(calls,2);assert.equal(sent.length,0);
  }finally{player.dispose();second.resolve({action:"skip",message:"",note:"I waited"});}
});

test("chat scheduling retains reading, thinking, typing and server-delay boundary",async(t)=>{
  t.mock.timers.enable({apis:["Date","setTimeout"],now:200000});
  const sent:{text:string;at:number}[]=[];
  const player=createAiPlayer({sessionGeneration:"g",roomCode:"TEST",aiPlayerId:"ai",persona:fallbackPersonaSamples()[0]!,actions:{
    submitAnswer:()=>({ok:true}),submitCollab:()=>({ok:true}),castVote:()=>({ok:true}),setVouch:()=>({ok:true}),sendChat:text=>{sent.push({text,at:Date.now()});return {ok:true,messageId:"sent",visibleAt:Date.now()+5000};}
  }},{random:()=>0,call:async<T>()=>({action:"send",message:"yeah fair",note:"I reacted briefly"} as T)});
  try {
    const view=roomView({phase:"discuss",messages:[message("trigger","Fox what do you think?")]});
    player.onEvent({type:"messageVisible",message:view.messages[0]!},view);
    for(let i=0;i<10;i++)await Promise.resolve();
    t.mock.timers.tick(2000);assert.equal(sent.length,0);
    t.mock.timers.tick(2250);assert.equal(sent.length,1);assert.equal(sent[0]!.at+5000-200000,9250);
    player.onEvent({type:"messageVisible",message:view.messages[0]!},view);for(let i=0;i<10;i++)await Promise.resolve();assert.equal(sent.length,1);
  }finally{player.dispose();t.mock.timers.reset();}
});

test("shortened deadline never extends a running answer; fallback cannot be overwritten",async()=>{
  const pending=deferred<unknown>(),h=controllerHarness(async<T>()=>await pending.promise as T);
  try {
    h.player.onEvent({type:"firstQuestionAnswersUpdated",snapshot:firstSnapshot(h.view)},h.view);await flush();
    const short={...h.view,phaseEndsAt:Date.now()+3015};h.player.onEvent({type:"stateUpdated"},short);await delay(40);
    assert.equal(h.submitted.length,1);pending.resolve({answer:"too late",note:"I was late"});await flush();assert.equal(h.submitted.length,1);
  }finally{h.player.dispose();}
});

test("diagnostic callbacks cannot turn successful calls into failures",async()=>{
  const call=createMuseCall({send:async()=>response({ok:true}),onMetric:()=>{throw new Error("logging failed");}});assert.deepEqual(await call(req),{ok:true});
  const player=createAiPlayer({sessionGeneration:"g",roomCode:"TEST",aiPlayerId:"ai",persona:fallbackPersonaSamples()[0]!,actions:{submitAnswer:()=>({ok:true}),submitCollab:()=>({ok:true}),castVote:()=>({ok:true}),setVouch:()=>({ok:true}),sendChat:()=>({ok:true,messageId:"x",visibleAt:0})}},
    {call,random:()=>1,onError:()=>{throw new Error("logging failed");}});
  try{assert.doesNotThrow(()=>player.onEvent({type:"stateUpdated"},roomView({code:"WRONG"})));}finally{player.dispose();}
});
