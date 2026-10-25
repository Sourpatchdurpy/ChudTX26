import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, roomView, firstSnapshot, message, roster, scenarioTexts, mockFixtureOutput } from "../fixtures/scenarios.js";
import { buildAnswerRequest,buildGroupChatRequest,buildPairChatRequest,buildCollabRequest } from "../prompts.js";
import { createSessionMemory, updateSessionMemory, recordAcceptedOutput, retrieveClaims, disposeSessionMemory } from "../memory.js";
import { fallbackPersonaSamples } from "../fallback-personas.js";
import { normalizePersona, personaSchema } from "../schemas.js";
import { selectGeneration, BASELINE_POLICY } from "../generation-policy.js";
import { computeStances } from "../stances.js";
import { selectExamples } from "../examples.js";
import { generatePersona } from "../persona.js";
import type { MuseCall } from "@game/shared";

test("five complete independent student and nonstudent personas",()=>{
  const pool=fallbackPersonaSamples();assert.equal(pool.length,5);assert.equal(new Set(pool.map(p=>p.blurb)).size,5);
  for(const p of pool){assert.equal("name" in p,false);assert.equal("style" in p,false);assert.equal("hackathonStory" in p,false);normalizePersona({...p,school:p.school??null,year:p.year??null,major:p.major??null});}
  assert.ok(pool.some(p=>!p.school&&!p.year&&!p.major));pool[0]!.facts[0]="mutated";assert.notEqual(fallbackPersonaSamples()[0]!.facts[0],"mutated");
  assert.throws(()=>normalizePersona({...pool[0],hackathonStory:"removed"}));
  assert.throws(()=>normalizePersona({...pool[0],school:null,year:null,major:null,name:"Removed Name"}));
  assert.equal("name" in (personaSchema.properties as object),false);
});
test("persona generation excludes all style preferences and rejects the removed style field",async()=>{
  const generated={...fallbackPersonaSamples()[0]!,school:null,year:null,major:null};
  assert.equal("style" in (personaSchema.properties as object),false);assert.ok(!(personaSchema.required as string[]).includes("style"));
  assert.throws(()=>normalizePersona({...generated,style:{casing:"lowercase",emojiRate:0.1,punctuation:"minimal"}}),/unexpected/);
  const world={fetchedAt:0,trending:[],news:[],local:[],weather:null,hacktx:[]};
  let generationInstructions="";
  const call:MuseCall=async<T>(request:Parameters<MuseCall>[0])=>{generationInstructions=request.messages[1]!.content;return generated as T;};
  const p=await generatePersona(world,call);assert.equal("style" in p,false);
  assert.ok(generationInstructions.includes("Do not generate a style section"));
  const serialized=buildGroupChatRequest(fixture("discuss-addressed")).messages[0]!.content;
  assert.ok(!serialized.includes('"style":'));
});
test("persona generation normalizes nullable nonstudent education and falls back on invalid objects",async()=>{
  const generated={...fallbackPersonaSamples()[2]!,school:null,year:null,major:null};
  const world={fetchedAt:0,trending:[],news:[],local:[],weather:null,hacktx:[]};
  const call:MuseCall=async<T>()=>generated as T;
  const p=await generatePersona(world,call);assert.equal(p.blurb,generated.blurb);assert.equal("name" in p,false);assert.equal("school" in p,false);assert.equal("year" in p,false);assert.equal("major" in p,false);
  const invalid:MuseCall=async<T>()=>({...generated,age:17,hackathonStory:"removed"}) as T;
  const fallback=await generatePersona(world,invalid);assert.ok(fallback.age>=18&&fallback.age<=24);assert.equal("hackathonStory" in fallback,false);
});
test("four modes route to exactly two stable family developer prompts",()=>{
  const ctx=fixture("discuss-addressed"),group=buildGroupChatRequest(ctx),pair=buildPairChatRequest(ctx),collab=buildCollabRequest(ctx),answer=buildAnswerRequest({...ctx,view:roomView(),firstQuestionHumanAnswers:firstSnapshot()});
  assert.equal(group.messages[0]!.content,pair.messages[0]!.content);assert.equal(pair.messages[0]!.content,collab.messages[0]!.content);assert.notEqual(answer.messages[0]!.content,group.messages[0]!.content);
  for(const req of [group,pair,collab,answer]){assert.equal(req.messages.length,2);assert.equal(req.messages[0]!.role,"developer");assert.equal(req.messages[1]!.role,"user");assert.equal(req.prompt_cache_key,"TEST");assert.equal(req.response_format?.json_schema.strict,true);}
});
test("every gameplay prompt uses the assigned nickname for self-identification",()=>{
  const answer=fixture("r1-answer-light"),group=fixture("discuss-addressed"),pair=fixture("pair-direct-questions"),collab=fixture("collab-result");
  for(const request of [buildAnswerRequest(answer),buildGroupChatRequest(group),buildPairChatRequest(pair),buildCollabRequest(collab)]) {
    const instructions=request.messages[0]!.content;
    assert.ok(instructions.includes('Your game-assigned nickname is "Fox"'));
    assert.ok(instructions.includes("Speak as yourself in first person"));
    assert.ok(instructions.includes("Your persona has no personal name; never invent or adopt one"));
    assert.ok(instructions.includes("Only when someone explicitly asks your name or nickname"));
    assert.ok(instructions.includes("do not add unsolicited identity corrections"));
    const data=JSON.parse(request.messages[1]!.content);
    assert.deepEqual(data.self,{playerId:"ai",nickname:"Fox",role:"you",perspective:"first person"});
  }
  const renamed=buildGroupChatRequest({...group,myNickname:"Otter"});
  assert.ok(renamed.messages[0]!.content.includes('Your game-assigned nickname is "Otter"'));
  assert.ok(!renamed.messages[0]!.content.includes('Your game-assigned nickname is "Fox"'));
});
test("conversation transcript marks the AI's own messages as you without adding speaker labels to text",()=>{
  const ctx=fixture("collab-result"),data=JSON.parse(buildCollabRequest(ctx).messages[1]!.content);
  const own=data.recentMessages.find((m:{from:string})=>m.from==="ai");
  assert.equal(own.speaker,"you");assert.equal(own.nickname,"Fox");assert.equal(own.text,"same, let's put cooking as our thing");
  assert.equal(data.recentMessages[0].speaker,"other-player");
});
test("discussion task targets its scenario instead of inheriting the food-answer task",()=>{
  for(const name of ["accused-1","accused-2","discuss-addressed","persona-consistency","complex-accusation"]) {
    const ctx=fixture(name),request=buildGroupChatRequest(ctx),data=JSON.parse(request.messages[1]!.content);
    assert.equal(data.mode,"group");assert.equal(data.activeTask.kind,"reply-to-message");
    assert.equal(data.activeTask.target.text,scenarioTexts[name]!.at(-1));
    const authorId=ctx.trigger.kind==="message"?ctx.trigger.message.from:"";
    assert.equal(data.activeTask.target.nickname,ctx.view.players.find(p=>p.id===authorId)?.nickname);
    assert.equal(data.round.prompt,undefined);assert.equal(data.roundBackground.status,"already-answered");
    assert.ok(!JSON.stringify(data).includes("What's your go-to food order?"));
    assert.ok(request.messages[0]!.content.includes("do not answer it again"));
  }
});
test("a real discussion view's round question is labeled background, while answer mode makes it the task",()=>{
  const ctx=fixture("accused-1");ctx.view.round=roomView().round;
  const chat=JSON.parse(buildGroupChatRequest(ctx).messages[1]!.content);
  assert.equal(chat.round.prompt,undefined);assert.equal(chat.roundBackground.question,"What's your go-to food order?");
  assert.equal(chat.activeTask.target.text,"Fox is the bot, that answer was too clean");assert.equal(chat.activeTask.question,undefined);
  const answer=JSON.parse(buildAnswerRequest(fixture("r1-answer-light")).messages[1]!.content);
  assert.equal(answer.activeTask.kind,"answer-question");assert.equal(answer.activeTask.question,"What's your go-to food order?");
});
test("pair and collaboration tasks distinguish partner reply from result submission",()=>{
  const pair=JSON.parse(buildPairChatRequest(fixture("pair-direct-questions")).messages[1]!.content);
  assert.equal(pair.activeTask.kind,"reply-to-message");assert.equal(pair.activeTask.target.text,"Fox what do you like cooking?");
  const collab=JSON.parse(buildCollabRequest(fixture("collab-result")).messages[1]!.content);
  assert.equal(collab.activeTask.kind,"submit-collaboration-result");assert.equal(collab.activeTask.submitPrompt,"One thing you agreed on");
  assert.equal(collab.round.prompt,undefined);
  for(const name of ["pair-direct-questions","pair-agreement-recall","trio-chat","collab-result"]) {
    const ctx=fixture(name),members=ctx.view.pairs![0]!.members;
    assert.ok(ctx.view.messages.every(m=>members.includes(m.from)),name);
  }
});
test("lab fixtures reject incompatible mode overrides and mocked replies vary with their scenario",()=>{
  assert.throws(()=>fixture("accused-1","answer"),/uses mode 'group'/);
  assert.throws(()=>fixture("r1-answer-light","group"),/uses mode 'answer'/);
  assert.doesNotThrow(()=>fixture("accused-1","group"));
  const direct=mockFixtureOutput("discuss-addressed",fixture("discuss-addressed")) as {message:string};
  const accused=mockFixtureOutput("accused-1",fixture("accused-1")) as {message:string};
  assert.notEqual(direct.message,accused.message);assert.ok(direct.message.includes("print"));
});
test("first answer includes every human privately without contaminating ordinary memory",()=>{
  const ctx=fixture("r1-answer-light"),before=structuredClone(ctx.memory),request=buildAnswerRequest(ctx),data=JSON.parse(request.messages[1]!.content);
  assert.equal(data.examples.length,3);assert.equal(data.answerWritingStyle.sampleCount,3);assert.equal(data.examples[0].visibility,"submitted-not-revealed");assert.deepEqual(ctx.memory,before);
  assert.equal(ctx.memory!.answerExamples.length,0);assert.equal(ctx.memory!.chatterProfiles.h1!.sampleCount,0);
  assert.ok(request.messages[0]!.content.includes("never become yours"));
});
test("incomplete first examples require explicit deadline exception",()=>{
  const ctx=fixture("r1-answer-light");ctx.firstQuestionHumanAnswers=firstSnapshot(ctx.view,"test-generation",1);
  assert.throws(()=>buildAnswerRequest(ctx),/waiting/);ctx.firstQuestionDeadlineException=true;assert.equal(selectExamples(ctx,ctx.memory!).length,1);
  ctx.firstQuestionHumanAnswers=undefined;ctx.firstQuestionDeadlineException=false;assert.throws(()=>buildAnswerRequest(ctx),/private snapshot/);
  ctx.firstQuestionDeadlineException=true;assert.equal(selectExamples(ctx,ctx.memory!).length,0);
});
test("later answers select actual previous questions with both author kinds and exclude current secrets",()=>{
  const ctx=fixture("r2-answer-personal");ctx.view.history.push({round:2,tier:"personal",promptId:"P1",prompt:"current",answers:[{playerId:"h2",text:"UNREVEALED SECRET"}],voteCounts:null});
  updateSessionMemory(ctx.memory!,ctx.view,"ai");const examples=selectExamples(ctx,ctx.memory!);
  assert.deepEqual(new Set(examples.map(e=>e.authorKind)),new Set(["self","human"]));assert.ok(examples.every(e=>e.round===1));assert.ok(!JSON.stringify(buildAnswerRequest(ctx)).includes("UNREVEALED SECRET"));
});
test("visible answer deduplication and resubmission replace contributions",()=>{
  const view=roomView({phase:"discuss",history:[{round:1,tier:"light",promptId:"L1",prompt:"q",answers:[{playerId:"h1",text:"one"}],voteCounts:null}]}),memory=createSessionMemory("g",view.players);
  updateSessionMemory(memory,view,"ai");updateSessionMemory(memory,view,"ai");assert.equal(memory.chatterProfiles.h1!.sampleCount,1);
  view.history[0]!.answers[0]!.text="one two three";updateSessionMemory(memory,view,"ai");assert.equal(memory.chatterProfiles.h1!.medianWords,3);assert.equal(memory.answerExamples.length,1);
});
test("claims are learned only from accepted output, with pending visibility and source retrieval",()=>{
  const ctx=fixture("memory-recall"),m=ctx.memory!;
  const output={key:"accepted",text:"I take the bus to the library",mode:"group" as const,round:1 as const,promptId:"L1",question:"q",visibility:"pending" as const,messageId:"echo"};
  assert.equal(recordAcceptedOutput(m,{ok:false,error:"stale"},output),false);assert.equal(m.establishedAiFacts.length,0);
  assert.equal(recordAcceptedOutput(m,{ok:true},output),true);assert.equal(recordAcceptedOutput(m,{ok:true},output),false);
  assert.equal(retrieveClaims(m,"which bus to the library?")[0]!.key,"accepted");assert.equal(m.acceptedOutputs[0]!.visibility,"pending");
  ctx.view.messages.push(message("echo",output.text,"ai"));updateSessionMemory(m,ctx.view,"ai");assert.equal(m.acceptedOutputs[0]!.visibility,"visible");
});
test("long memory keeps archive, bounded recent window and retrieves old pair agreement",()=>{
  const ctx=fixture("long-session"),data=JSON.parse(buildGroupChatRequest(ctx).messages[1]!.content);
  assert.equal(ctx.memory!.messages.length,120);assert.equal(data.recentMessages.length,8);assert.ok(ctx.memory!.summary.length>0);
  assert.equal(data.humans.length,3);assert.ok(data.humans.some((h:{typing:{sampleCount:number}})=>h.typing.sampleCount===0));
});
test("older pair agreement remains source-linked after leaving the recent window",()=>{
  const ctx=fixture("pair-agreement-recall");
  ctx.view.messages=[message("agreement","we both agreed on cooking soup","h1",1,"p1"),...Array.from({length:15},(_,i)=>message(`later${i}`,`another topic ${i}`,"h1",i+2,"p1")),message("recall","Fox what did we settle on?","h1",30,"p1")];
  ctx.trigger={kind:"message",message:ctx.view.messages.at(-1)!};ctx.memory=createSessionMemory("test-generation",ctx.view.players);updateSessionMemory(ctx.memory,ctx.view,"ai");
  const data=JSON.parse(buildCollabRequest(ctx).messages[1]!.content);
  assert.ok(data.olderEvidence.some((e:{id:string;text:string})=>e.id==="agreement"&&e.text==="we both agreed on cooking soup"));
  assert.equal(data.recentMessages.length,8);assert.deepEqual(data.partners,["h1"]);
});
test("unseen pair chats are excluded and sessions dispose completely",()=>{
  const view=roomView({phase:"pairChat",pairs:[{id:"own",members:["ai","h1"]}],messages:[message("foreign","secret","h2",Date.now(),"other")]});
  const m=updateSessionMemory(createSessionMemory("g1",roster),view,"ai");assert.equal(m.messages.length,0);
  disposeSessionMemory(m);assert.equal(m.disposed,true);assert.equal(m.processedMessageIds.size,0);assert.throws(()=>updateSessionMemory(m,view,"ai"));assert.equal(createSessionMemory("g2",roster).summary,"");
});
test("injection delimiters stay JSON data and do not alter stable developer instruction",()=>{
  const a=buildGroupChatRequest(fixture("injection-attempt")),b=buildGroupChatRequest(fixture("discuss-quiet"));assert.equal(a.messages[0]!.content,b.messages[0]!.content);
  assert.equal(JSON.parse(a.messages[1]!.content).recentMessages[0].text,scenarioTexts["injection-attempt"]![0]);
});
test("observed stances handle negation, mixed signals, uncertainty and older evidence",()=>{
  const stance=(texts:string[])=>computeStances(texts.map((t,i)=>message(`${i}`,t,"h1",i)),roster,"ai","Fox",[]).h1!;
  assert.equal(stance(["Fox isn't the bot"]).stance,"defending");assert.equal(stance(["I don't trust Fox"]).stance,"skeptical");assert.equal(stance(["Fox is the bot","I trust Fox"]).stance,"mixed");
  assert.equal(stance(["Fox is the bot but I trust Fox"]).stance,"mixed");assert.equal(stance(["I don't think Fox is a bot"]).stance,"defending");
  assert.equal(stance(["Fox, Owl is the bot"]).strength,"tentative");assert.notEqual(stance(["Fox, Owl is the bot"]).stance,"skeptical");
  assert.equal(stance(["Fox is human yeah right /s"]).strength,"tentative");assert.equal(stance(["he's the bot"]).stance,"unknown");
  assert.equal(stance(["Fox is a bot",...Array.from({length:9},()=>"okay")]).evidence[0]!.older,true);
  assert.equal(stance(["Fox is a bot",...Array.from({length:9},()=>"okay"),"Fox what food do you like?"]).stance,"skeptical");
});
test("generation policy requires approval, evidence, deadline and hysteresis",()=>{
  const long=Array.from({length:5},()=>Array.from({length:45},()=>"long").join(" ")+". Why?"),policy={...BASELINE_POLICY,approved:["baseline","expanded","complex"] as const,evaluated:["baseline","expanded","complex"] as const};
  const p={...policy,approved:[...policy.approved],evaluated:[...policy.evaluated]};
  assert.equal(selectGeneration(long,"",20000).tier,"baseline");const complex=selectGeneration(long,"",20000,p);assert.equal(complex.tier,"complex");
  assert.equal(selectGeneration(long,"",6500,p).tier,"baseline");assert.equal(selectGeneration(long.slice(0,2),"",20000,p).tier,"baseline");
  const a=selectGeneration(["hi"],"",20000,p,complex.state),b=selectGeneration(["hi"],"",20000,p,a.state),c=selectGeneration(["hi"],"",20000,p,b.state);
  assert.equal(a.tier,"complex");assert.equal(b.tier,"complex");assert.equal(c.tier,"baseline");
});
