import {test} from "node:test";
import assert from "node:assert/strict";
import {fixture,message} from "../fixtures/scenarios.js";
import {createSessionMemory,updateSessionMemory} from "../memory.js";
import {inferWritingStyle} from "../writing-style.js";
import {buildGroupChatRequest,buildAnswerRequest} from "../prompts.js";
import {validateStructuredOutput} from "../runtime/pipeline.js";

function discussion(lowercase:boolean) {
  const ctx=fixture("discuss-addressed");
  ctx.view.messages=Array.from({length:6},(_,i)=>message(`m${i}`,lowercase?"yeah i agree":"Yes, I agree.","h1",i));
  ctx.trigger={kind:"message",message:ctx.view.messages.at(-1)!};
  ctx.memory=updateSessionMemory(createSessionMemory("test-generation",ctx.view.players),ctx.view,"ai");
  return ctx;
}
test("casing and punctuation follow observed player habits, independently of caller style defaults",()=>{
  const casual=discussion(true),formal=discussion(false);
  const low=inferWritingStyle(casual),high=inferWritingStyle(formal);
  assert.equal(low.style.lowercaseStartRatio,1);assert.equal(low.style.endsWithPeriodRatio,0);
  assert.equal(high.style.lowercaseStartRatio,0);assert.equal(high.style.endsWithPeriodRatio,1);
  assert.equal(low.source,"observed-player-habits");assert.deepEqual(low.focusPlayerIds,["h1"]);
  const output={action:"send",message:"The walk was nice.",note:"I answered directly"};
  assert.equal(validateStructuredOutput(output,"group",casual).text,"the walk was nice");
  assert.equal(validateStructuredOutput(output,"group",formal).text,"The walk was nice.");
});
test("switching the addressed player selects their observed habits",()=>{
  const ctx=discussion(true);
  ctx.view.messages.push(...Array.from({length:6},(_,i)=>message(`formal${i}`,"Yes, that sounds good.","h2",i+10)));
  updateSessionMemory(ctx.memory!,ctx.view,"ai");
  assert.equal(inferWritingStyle(ctx).style.lowercaseStartRatio,1);
  ctx.trigger={kind:"message",message:ctx.view.messages.at(-1)!};
  assert.equal(inferWritingStyle(ctx).style.lowercaseStartRatio,0);
  const data=JSON.parse(buildGroupChatRequest(ctx).messages[1]!.content);
  assert.equal(data.writingStyle.playerHabits.find((p:{playerId:string})=>p.playerId==="h1").observed.endsWithPeriodRatio,0);
  assert.equal(data.writingStyle.playerHabits.find((p:{playerId:string})=>p.playerId==="h2").observed.endsWithPeriodRatio,1);
});
test("sparse player evidence uses the recent human room baseline and excludes AI messages",()=>{
  const ctx=discussion(false);
  ctx.view.messages.push(message("short","hey","h2",10),message("self","my lowercase style","ai",11));
  ctx.trigger={kind:"message",message:ctx.view.messages.at(-2)!};updateSessionMemory(ctx.memory!,ctx.view,"ai");
  const inferred=inferWritingStyle(ctx);
  assert.equal(inferred.source,"recent-human-messages");assert.equal(inferred.sampleCount,7);assert.deepEqual(inferred.focusPlayerIds,[]);
  assert.equal(inferred.style.lowercaseStartRatio,1/7);assert.equal(inferred.playerHabits.find(p=>p.playerId==="h2")!.tentative,true);
});
test("first-answer style comes from private human answers without contaminating chat profiles",()=>{
  const ctx=fixture("r1-answer-light"),before=structuredClone(ctx.memory);
  ctx.firstQuestionHumanAnswers!.answers.forEach(a=>{a.text="Yes, a proper answer.";});
  const inferred=inferWritingStyle(ctx),data=JSON.parse(buildAnswerRequest(ctx).messages[1]!.content);
  assert.equal(inferred.source,"human-answer-examples");assert.equal(inferred.style.lowercaseStartRatio,0);assert.equal(inferred.style.endsWithPeriodRatio,1);
  assert.equal(data.writingStyle.sampleCount,3);assert.deepEqual(ctx.memory,before);
});
test("empty history uses neutral writing instead of persona style",()=>{
  const ctx=fixture("empty-history"),inferred=inferWritingStyle(ctx);
  assert.equal(inferred.source,"no-observations");assert.equal(inferred.sampleCount,0);
  assert.equal(inferred.style.lowercaseStartRatio,0);assert.equal(inferred.style.endsWithPeriodRatio,1);assert.equal(inferred.style.emojiPerMessage,0);
  const req=buildGroupChatRequest(ctx);assert.ok(req.messages[0]!.content.includes("never from persona facts or grammatical examples"));
});
