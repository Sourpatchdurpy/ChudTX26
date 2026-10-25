import type { ChatMessage, RoundAnswer, StyleProfile } from "@game/shared";
import { selectExamples } from "./examples.js";
import { createSessionMemory, updateSessionMemory } from "./memory.js";
import { computeStyleProfile } from "./style.js";
import type { PlayerTurnContext } from "./types.js";

/** Request-local observations. Private first-answer examples never enter profiles. */
export function inferWritingStyle(ctx:PlayerTurnContext) {
  const memory=ctx.memory??updateSessionMemory(createSessionMemory(ctx.firstQuestionHumanAnswers?.sessionGeneration??"temporary",ctx.view.players),ctx.view,ctx.aiPlayerId);
  const humans=ctx.view.players.filter(p=>p.id!==ctx.aiPlayerId);
  let messages:ChatMessage[]=[],answers:RoundAnswer[]=[];
  if(ctx.mode==="answer") {
    answers=selectExamples(ctx,memory).filter(e=>e.authorKind==="human").map(e=>({playerId:e.authorId,text:e.answer}));
  } else {
    messages=memory.messages.filter(m=>humans.some(p=>p.id===m.from));
    answers=memory.answerExamples.filter(e=>e.authorKind==="human"&&e.visibility==="revealed").map(e=>({playerId:e.authorId,text:e.answer}));
  }
  const habits=humans.map(p=>{
    const ownMessages=messages.filter(m=>m.from===p.id),ownAnswers=answers.filter(a=>a.playerId===p.id);
    const sampleCount=ownMessages.length+ownAnswers.length;
    return {playerId:p.id,nickname:p.nickname,sampleCount,tentative:sampleCount<5,
      observed:sampleCount?computeStyleProfile(ownMessages,ownAnswers,ctx.aiPlayerId):null};
  });
  const partners=ctx.view.pairs?.find(p=>p.members.includes(ctx.aiPlayerId))?.members.filter(id=>id!==ctx.aiPlayerId)??[];
  const focus=ctx.mode==="pair"||ctx.mode==="collab"?partners:ctx.mode==="group"&&ctx.trigger.kind==="message"?[ctx.trigger.message.from]:[];
  const establishedFocus=focus.filter(id=>habits.some(p=>p.playerId===id&&!p.tentative));
  // Recent room chat is the baseline; established partner/trigger-author habits
  // take priority. Answer mode uses only eligible human answer examples.
  let selectedMessages=ctx.mode==="answer"?[]:messages.slice(-8),selectedAnswers=ctx.mode==="answer"?answers:[];
  let source="recent-human-messages";
  if(ctx.mode==="answer")source="human-answer-examples";
  else if(establishedFocus.length) {
    selectedMessages=messages.filter(m=>establishedFocus.includes(m.from)).slice(-8);
    selectedAnswers=answers.filter(a=>establishedFocus.includes(a.playerId));source="observed-player-habits";
  } else if(!selectedMessages.length) {selectedAnswers=answers;source="revealed-human-answers";}
  const sampleCount=selectedMessages.length+selectedAnswers.length;
  const style:StyleProfile=sampleCount?computeStyleProfile(selectedMessages,selectedAnswers,ctx.aiPlayerId):{
    medianChars:40,lowercaseStartRatio:0,endsWithPeriodRatio:1,emojiPerMessage:0,commonTokens:[],sampleMessages:[]
  };
  return {style,source:sampleCount?source:"no-observations",sampleCount,tentative:sampleCount<5,
    focusPlayerIds:establishedFocus,playerHabits:habits};
}
