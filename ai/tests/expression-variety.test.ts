import {test} from "node:test";
import assert from "node:assert/strict";
import type {MuseCall,MuseChatRequest} from "@game/shared";
import type {PlayerTurnContext} from "../types.js";
import {fixture,message} from "../fixtures/scenarios.js";
import {recordAcceptedOutput,updateSessionMemory} from "../memory.js";
import {expressionGuidance} from "../expression-variety.js";
import {buildGroupChatRequest} from "../prompts.js";
import {generateTurn,validateStructuredOutput} from "../runtime/pipeline.js";

const reply=(text:string)=>({action:"send",message:text,note:"I answered directly"});

test("occasional filler is allowed, but repeating an opening is rejected across modes",()=>{
  for(const mode of ["answer","group","pair","collab"] as const) {
    const ctx:PlayerTurnContext={...fixture(mode==="answer"?"r1-answer-light":"discuss-addressed"),mode,saidSoFar:[]};
    const value=(text:string)=>mode==="answer"?{answer:text,note:"I answered"}:mode==="collab"?{result:text,note:"I agreed"}:reply(text);
    assert.doesNotThrow(()=>validateStructuredOutput(value("lol I walk there"),mode,ctx));
    ctx.saidSoFar=["LOL, I usually walk"];
    assert.throws(()=>validateStructuredOutput(value("lol I take the bus"),mode,ctx),/repeated filler expression: lol/u);
    assert.doesNotThrow(()=>validateStructuredOutput(value("I take the bus"),mode,ctx));
  }
});

test("frequent filler inside replies is avoided without matching parts of words",()=>{
  const ctx=fixture("discuss-addressed");
  ctx.saidSoFar=["I walk there tbh","I like the view tbh","The river is nearby"];
  assert.throws(()=>validateStructuredOutput(reply("I take the bus tbh"),"group",ctx),/repeated filler/u);
  ctx.saidSoFar=["lol I walk there"];
  assert.doesNotThrow(()=>validateStructuredOutput(reply("I like lollipops"),"group",ctx));
});

test("human catchphrases do not count as AI repetition and new sessions start fresh",()=>{
  const ctx=fixture("discuss-addressed");
  ctx.view.messages=[message("h1","lol yes"),message("h2","lol exactly")];
  updateSessionMemory(ctx.memory!,ctx.view,ctx.aiPlayerId);
  assert.deepEqual(expressionGuidance(ctx).avoidExpressions,[]);
  ctx.saidSoFar=["lol I walk there"];
  const data=JSON.parse(buildGroupChatRequest(ctx).messages[1]!.content);
  assert.ok(data.expressionVariety.avoidExpressions.includes("lol"));
  assert.deepEqual(expressionGuidance(fixture("discuss-addressed")).avoidExpressions,[]);
});

test("accepted replies drive repetition checks without double-counting their visible echoes",()=>{
  const ctx=fixture("discuss-addressed"),memory=ctx.memory!;
  const accepted={key:"first",text:"I walk there lol",mode:"group" as const,round:1 as const,promptId:"L1",question:"q",visibility:"visible" as const,messageId:"echo"};
  recordAcceptedOutput(memory,{ok:true},accepted);
  ctx.view.messages.push(message("echo",accepted.text,"ai"));updateSessionMemory(memory,ctx.view,ctx.aiPlayerId);
  assert.deepEqual(expressionGuidance(ctx).avoidExpressions,[]);
  recordAcceptedOutput(memory,{ok:true},{...accepted,key:"second",messageId:"second",text:"I take the bus lol"});
  assert.ok(expressionGuidance(ctx).avoidExpressions.includes("lol"));
});

test("repeated filler regenerates once with feedback and preserves the direct answer",async()=>{
  const ctx=fixture("discuss-addressed");ctx.saidSoFar=["lol I walk there"];
  const requests:ReturnType<typeof buildGroupChatRequest>[]=[];
  const call:MuseCall=async<T>(req:MuseChatRequest)=>{requests.push(req);return (requests.length===1?reply("lol I take the bus"):reply("I take the bus")) as T;};
  const result=await generateTurn(ctx,call,new AbortController().signal,Date.now()+10000);
  assert.equal(result.fallback,false);assert.equal(result.regenerations,1);
  assert.match(result.text,/take the bus/iu);assert.doesNotMatch(result.text,/\blol\b/iu);
  assert.match(JSON.parse(requests[1]!.messages[1]!.content).regenerationFeedback,/repeated filler expression: lol/u);
});
