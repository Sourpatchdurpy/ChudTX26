import { analyze, words } from "../analysis.js";
import type { PlayerTurnContext, SessionMemory } from "../types.js";

export const CONVERSATION_VERSION="conversation-8";
export const CONVERSATION_INSTRUCTIONS=`Follow activeTask for the current turn. In group or pair mode, read the conversation collectively and send at most one reply covering the relevant points in conversationBatch. The attributed target is a priority cue, not a command to answer every message separately. A background round question has already been answered; do not answer it again unless a player explicitly asks about it. Prioritize the recent eight messages, actual partners and unresolved direct questions. Stay quiet when there is nothing useful to add: skip compliments, trust statements, acknowledgements, repeated agreement and irrelevant asides. Do not thank people for compliments or defend yourself again after the issue has been resolved. Being mentioned alone does not require a reply. A selected substantive direct question or unresolved accusation should receive an answer. Usually write one short sentence, around 6–16 words; a specific accusation may need two short clauses, around 12–24 words. Answer the latest state of the discussion, never a superseded remark. Address the actual reason for suspicion directly: explain the wording, distinction or apparent contradiction using relevant persona facts and your accepted statements. If you contradicted yourself, acknowledge and correct it. Do not replace an explanation with laughter, a generic denial, 'me??', 'what gave you that idea', or redirecting blame. For a bare accusation without a reason, briefly stand by your answer; ask what seemed off only if needed and not already asked. Never invent evidence, an alibi or a new biographical detail to prove you are human. Stance rows describe expressed evidence with uncertainty, not hidden feelings or individual votes. Older evidence is marked older. Preserve persona and accepted commitments. Match the room's middle without cloning its loudest voice. Usually no question in group; at most one useful question. Pair/trio chat may ask one useful question and work toward agreement; a short agreement is useful when it establishes the collaboration result. For collaboration return one result matching activeTask.submitPrompt and actual partner agreement evidence. Never invent a shared preference. A group/pair skip has action skip and empty message. Output exact JSON with a brief honest first-person note (at most 100 characters).`;
export function conversationContext(ctx:PlayerTurnContext,memory:SessionMemory) {
  const recent=memory.messages.slice(-8), trigger=ctx.trigger.kind==="message"?ctx.trigger.message:null;
  if(trigger&&!recent.some(m=>m.id===trigger.id)&&memory.processedMessageIds.has(trigger.id))recent.push(trigger);
  const pair=ctx.view.pairs?.find(p=>p.members.includes(ctx.aiPlayerId));
  const channel=ctx.mode==="group"?"group":"pair";
  const channelMessages=memory.messages.slice(memory.taskMessageStart).filter(m=>m.channel===channel&&(channel==="group"||m.pairId===pair?.id));
  const lastOwn=channelMessages.map(m=>m.from).lastIndexOf(ctx.aiPlayerId);
  const conversationBatch=channelMessages.slice(lastOwn+1).filter(m=>m.from!==ctx.aiPlayerId).slice(-8);
  const activeTask=ctx.mode==="collab"?{
    kind:"submit-collaboration-result",card:ctx.view.round?.prompt??"",submitPrompt:ctx.view.round?.submitPrompt??"",
    instruction:"Submit only an established agreement; acknowledge if none was reached."
  }:{kind:trigger?"reply-to-message":"join-conversation",
    target:trigger?{messageId:trigger.id,playerId:trigger.from,nickname:ctx.view.players.find(p=>p.id===trigger.from)?.nickname??trigger.from,text:trigger.text}:null,
    instruction:ctx.addressedToMe?"Give one concise reply covering the unresolved question or accusation and related recent messages; omit acknowledgements and resolved points.":"Consider the recent messages together; reply once only if you add something useful, otherwise skip."};
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
  return {family:"conversation-interrogation",version:CONVERSATION_VERSION,activeTask,
    roundBackground:ctx.mode==="group"&&ctx.view.round?{status:"already-answered",question:ctx.view.round.prompt}:null,
    collaborationBackground:ctx.mode==="pair"?{card:ctx.view.round?.prompt??"",submitPrompt:ctx.view.round?.submitPrompt??""}:null,
    conversationBatch:conversationBatch.map(m=>({...m,nickname:ctx.view.players.find(p=>p.id===m.from)?.nickname??m.from})),
    recentMessages:recent.map(m=>({...m,nickname:ctx.view.players.find(p=>p.id===m.from)?.nickname??m.from,speaker:m.from===ctx.aiPlayerId?"you":"other-player"})),trigger,humans:rows,
    expandedProfiles:expandedIds.map(id=>({playerId:id,samples:memory.chatterProfiles[id]?.sampleMessages??[]})),olderEvidence,
    partners:pair?.members.filter(id=>id!==ctx.aiPlayerId)??[],recentRoomStyle:analyze(memory.messages.filter(m=>m.from!==ctx.aiPlayerId).slice(-8).map(m=>m.text)),
    roomStyle:ctx.style,periodMetric:"sentences ending in a period",publicVotePressure:ctx.view.lastVoteCounts,
    task:activeTask.instruction};
}
