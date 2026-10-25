import { analyze, words } from "../analysis.js";
import type { PlayerTurnContext, SessionMemory } from "../types.js";

export const CONVERSATION_VERSION="conversation-1";
export const CONVERSATION_INSTRUCTIONS=`Participate in the immediate exchange. Prioritize the recent eight messages, actual partners and their direct questions. A directly addressed selected turn must answer rather than skip. React naturally; accusations call for brief humor or mild disagreement, not proof paragraphs or redirecting blame. Stance rows describe expressed evidence with uncertainty, not hidden feelings or individual votes. Older evidence is marked older. Preserve persona and accepted commitments. Match the room's middle without cloning its loudest voice. Usually no question in group; at most one useful question. Pair/trio chat may ask one useful question and work toward agreement. For collaboration return one result matching submitPrompt and actual partner agreement evidence. Never invent a shared preference. A group/pair skip has action skip and empty message. Output exact JSON with a brief honest first-person note (at most 100 characters).`;
export function conversationContext(ctx:PlayerTurnContext,memory:SessionMemory) {
  const recent=memory.messages.slice(-8), trigger=ctx.trigger.kind==="message"?ctx.trigger.message:null;
  if(trigger&&!recent.some(m=>m.id===trigger.id)&&memory.processedMessageIds.has(trigger.id))recent.push(trigger);
  const pair=ctx.view.pairs?.find(p=>p.members.includes(ctx.aiPlayerId));
  const priority=[...(pair?.members??[]),...(trigger?[trigger.from]:[]),...ctx.view.players.filter(p=>trigger?.text.includes(p.nickname)).map(p=>p.id)];
  const expandedIds=[...new Set(priority)].filter(id=>id!==ctx.aiPlayerId).slice(0,3);
  const rows=ctx.view.players.filter(p=>p.id!==ctx.aiPlayerId).map(p=>{
    const profile=memory.chatterProfiles[p.id]!,stance=memory.playerStances[p.id];
    return {playerId:p.id,nickname:p.nickname,typing:{sampleCount:profile.sampleCount,tentative:profile.tentative,medianWords:profile.medianWords,minWords:profile.minWords,maxWords:profile.maxWords,lowercaseWordRatio:profile.lowercaseWordRatio,periodSentenceRatio:profile.periodSentenceRatio,emojiMessageRatio:profile.emojiMessageRatio},
      stance:{observed:stance?.stance??"unknown",strength:stance?.strength??"none",evidence:stance?.evidence??[],unresolvedQuestions:stance?.unresolvedQuestions.slice(-3)??[]}};
  });
  const terms=new Set(words(trigger?.text.toLowerCase()??ctx.view.round?.submitPrompt?.toLowerCase()??"").filter(w=>w.length>3));
  const olderEvidence=memory.messages.slice(0,-8).map((m,index)=>({m,index,score:words(m.text.toLowerCase()).filter(w=>terms.has(w)).length+(m.channel==="pair"&&/agree|both|settled|let.s go with/iu.test(m.text)?4:0)}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.index-a.index).slice(0,4).map(x=>x.m);
  return {family:"conversation-interrogation",version:CONVERSATION_VERSION,recentMessages:recent,trigger,humans:rows,
    expandedProfiles:expandedIds.map(id=>({playerId:id,samples:memory.chatterProfiles[id]?.sampleMessages??[]})),olderEvidence,
    partners:pair?.members.filter(id=>id!==ctx.aiPlayerId)??[],recentRoomStyle:analyze(memory.messages.filter(m=>m.from!==ctx.aiPlayerId).slice(-8).map(m=>m.text)),
    roomStyle:ctx.style,periodMetric:"sentences ending in a period",publicVotePressure:ctx.view.lastVoteCounts,
    task:ctx.mode==="collab"?"Submit only an established agreement; acknowledge if none was reached.":ctx.addressedToMe?"Answer the direct question; do not skip.":"Send one relevant reaction or skip."};
}
