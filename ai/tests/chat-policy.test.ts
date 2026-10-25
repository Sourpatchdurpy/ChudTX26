import {test} from "node:test";
import assert from "node:assert/strict";
import {asksForChatReply,isLowValueChat,isResolvedChat} from "../chat-policy.js";
import {fixture,message} from "../fixtures/scenarios.js";
import {updateSessionMemory} from "../memory.js";
import {buildGroupChatRequest} from "../prompts.js";
import {validateStructuredOutput} from "../runtime/pipeline.js";

test("courtesy filtering preserves questions, accusations and useful pair agreements",()=>{
  for(const text of ["nice answer Fox","I trust Fox","thanks, I appreciate that","Fox isn't the bot","yeah fair"])assert.equal(isLowValueChat(text,"Fox"),true,text);
  for(const text of ["Fox why did your shift change?","Fox is the bot","I trust Fox but that shift doesn't add up","I work two afternoons"])assert.equal(isLowValueChat(text,"Fox"),false,text);
  assert.equal(isLowValueChat("yeah fair","Fox",false),false);
  assert.equal(asksForChatReply("Fox that was a pretty good answer"),false);
  assert.equal(asksForChatReply("Fox explain the shift overlap"),true);
});

test("an accusation rejects an empty denial but allows a specific explanation",()=>{
  const ctx=fixture("accused-2");
  for(const text of ["me??","what gave you that idea","lol i don't see it"])assert.throws(()=>validateStructuredOutput({action:"send",message:text,note:"I defended my answer"},"group",ctx),/generic denial or deflection/u);
  assert.doesNotThrow(()=>validateStructuredOutput({action:"send",message:"I work two afternoons at the library, after class",note:"I explained my shift"},"group",ctx));
});

test("discussion context groups unanswered messages and preserves the exact accusation",()=>{
  const ctx=fixture("accused-2");
  ctx.view.messages.push(message("other","Fox why does that shift overlap class?","h2"));
  updateSessionMemory(ctx.memory!,ctx.view,ctx.aiPlayerId);
  let data=JSON.parse(buildGroupChatRequest(ctx).messages[1]!.content);
  assert.equal(data.conversationBatch.length,2);
  assert.equal(data.activeTask.target.text,ctx.view.messages[0]!.text);
  ctx.view.messages.push(message("mine","My shift starts after class","ai"),message("next","What about Friday?","h1"));
  updateSessionMemory(ctx.memory!,ctx.view,ctx.aiPlayerId);
  data=JSON.parse(buildGroupChatRequest(ctx).messages[1]!.content);
  assert.deepEqual(data.conversationBatch.map((m:{id:string})=>m.id),["next"]);
});

test("compliments can be skipped even when they contain the AI nickname",()=>{
  const ctx=fixture("discuss-addressed");ctx.trigger={kind:"message",message:message("praise","nice answer Fox")};
  assert.equal(validateStructuredOutput({action:"skip",message:"",note:"I had nothing to add"},"group",ctx).action,"skip");
  ctx.trigger={kind:"message",message:message("question","Fox why that answer?")};
  assert.throws(()=>validateStructuredOutput({action:"send",message:"thanks I appreciate that",note:"I replied"},"group",ctx),/empty acknowledgement/u);
  ctx.addressedToMe=false;
  assert.equal(validateStructuredOutput({action:"send",message:"yeah fair",note:"I agreed"},"group",ctx).action,"skip");
});

test("the accuser can resolve a challenge, while another player's trust leaves it open",()=>{
  const ctx=fixture("accused-1"),trigger=ctx.view.messages[0]!;
  ctx.view.messages.push(message("defender","I trust Fox","h2"));
  assert.equal(isResolvedChat(trigger,ctx.view.messages,"Fox"),false);
  ctx.view.messages.push(message("resolved","ok that makes sense",trigger.from));
  assert.equal(isResolvedChat(trigger,ctx.view.messages,"Fox"),true);
  assert.equal(validateStructuredOutput({action:"skip",message:"",note:"They withdrew the accusation"},"group",ctx).action,"skip");
});
