import type { AckResult, PublicPlayer, RoomView } from "@game/shared";
import { analyze, words } from "./analysis.js";
import { computeChatterProfiles } from "./style.js";
import { computeStances, mentions } from "./stances.js";
import type { AcceptedOutput, SessionMemory } from "./types.js";

export function createSessionMemory(sessionGeneration:string,roster:PublicPlayer[]):SessionMemory {
  if(!sessionGeneration)throw new Error("session generation required");
  return {sessionGeneration,roster:structuredClone(roster),summary:"",summarizedThroughMessageId:null,establishedAiFacts:[],chatterProfiles:{},playerStances:{},answerExamples:[],messages:[],processedMessageIds:new Set(),visibleAnswerKeys:new Set(),acceptedOutputs:[],revision:0,disposed:false,taskKey:"",taskMessageStart:0};
}
export function updateSessionMemory(memory:SessionMemory,view:RoomView,aiId:string):SessionMemory {
  if(memory.disposed)throw new Error("disposed session");
  const taskKey=`${view.phase}:${view.round?.number??0}`;
  if(taskKey!==memory.taskKey)memory.taskMessageStart=memory.taskKey?memory.messages.length:0;
  memory.roster=structuredClone(view.players);
  const ownPair=view.pairs?.find(p=>p.members.includes(aiId));
  for(const m of view.messages) {
    if(m.channel==="pair"&&(!ownPair||m.pairId!==ownPair.id))continue;
    if(!memory.processedMessageIds.has(m.id)) {memory.processedMessageIds.add(m.id);memory.messages.push(structuredClone(m));}
  }
  memory.messages.sort((a,b)=>a.at-b.at);
  for(const out of memory.acceptedOutputs) if(out.messageId&&memory.processedMessageIds.has(out.messageId)) {
    out.visibility="visible";
    const index=memory.acceptedOutputs.indexOf(out);memory.establishedAiFacts[index]=`[${out.key}; visible] ${out.text}`;
  }
  for(const round of view.history) {
    // Defensive exclusion even if an incorrect view contains unrevealed current answers.
    if(round.round===view.round?.number&&view.phase==="answer")continue;
    for(const a of round.answers) {
      if(a.text===null)continue;
      const key=`${memory.sessionGeneration}:${round.round}:${a.playerId}`;
      memory.visibleAnswerKeys.add(key);
      const ex={sessionGeneration:memory.sessionGeneration,round:round.round,promptId:round.promptId,question:round.prompt,
        authorId:a.playerId,nickname:view.players.find(p=>p.id===a.playerId)?.nickname??a.playerId,
        authorKind:a.playerId===aiId?"self" as const:"human" as const,visibility:"revealed" as const,answer:a.text,sourceKey:key};
      const old=memory.answerExamples.findIndex(e=>e.sourceKey===key);
      if(old<0)memory.answerExamples.push(ex);else memory.answerExamples[old]=ex;
    }
  }
  const answers=memory.answerExamples.filter(a=>a.visibility==="revealed").map(a=>({playerId:a.authorId,text:a.answer}));
  memory.chatterProfiles=computeChatterProfiles(memory.messages,answers,aiId);
  for(const p of view.players.filter(p=>p.id!==aiId)) if(!memory.chatterProfiles[p.id]) memory.chatterProfiles[p.id]={
    ...analyze([]),playerId:p.id,commonTokens:[],sampleMessages:[],tentative:true};
  const self=memory.acceptedOutputs.filter(o=>o.mode==="answer").map(o=>o.text);
  // Accepted replies do not prove a particular question has been answered.
  // Keep unresolved evidence until the task changes, rather than guessing semantic resolution.
  const stances=computeStances(memory.messages,view.players,aiId,view.players.find(p=>p.id===aiId)?.nickname??"",self);
  for(const stance of Object.values(stances))stance.unresolvedQuestions=stance.unresolvedQuestions.filter(q=>memory.messages.findIndex(m=>m.id===q.sourceId)>=memory.taskMessageStart);
  memory.playerStances=stances;memory.taskKey=taskKey;
  const old=memory.messages.slice(0,-8);
  memory.summarizedThroughMessageId=old.at(-1)?.id??null;
  const aiName=view.players.find(p=>p.id===aiId)?.nickname??"";
  const candidates=old.map((m,index)=>({index,priority:m.from===aiId||mentions(m.text,aiName)||m.text.includes("?")?3:/agree|both|settled|let.s go with/iu.test(m.text)?4:1,
    line:`[${m.id}] ${view.players.find(p=>p.id===m.from)?.nickname??m.from}: ${JSON.stringify(m.text)}`}));
  const selected:typeof candidates=[];let used=0;
  for(const c of candidates.sort((a,b)=>b.priority-a.priority||b.index-a.index)) {const n=words(c.line).length;if(used+n<=270){selected.push(c);used+=n;}}
  const answerLines=memory.answerExamples.filter(e=>e.visibility==="revealed").slice(-4).map(e=>`[${e.sourceKey}] ${e.nickname} answered ${JSON.stringify(e.question)}: ${JSON.stringify(e.answer)}`);
  const summaryLines=[...answerLines,...selected.sort((a,b)=>a.index-b.index).map(c=>c.line)];
  let summaryWords=0;
  memory.summary=summaryLines.filter(line=>{const count=words(line).length;if(summaryWords+count>350)return false;summaryWords+=count;return true;}).join("\n");
  memory.revision++;return memory;
}
export function recordAcceptedOutput(memory:SessionMemory,ack:AckResult,output:AcceptedOutput):boolean {
  if(!ack.ok||memory.disposed||memory.acceptedOutputs.some(o=>o.key===output.key))return false;
  memory.acceptedOutputs.push(structuredClone(output));
  memory.establishedAiFacts.push(`[${output.key}; ${output.visibility}] ${output.text}`);
  memory.revision++;return true;
}
export function retrieveClaims(memory:SessionMemory,trigger:string):AcceptedOutput[] {
  const terms=new Set(words(trigger.toLowerCase()).filter(w=>w.length>3));
  return memory.acceptedOutputs.map((o,index)=>({o,index,score:trigger.includes(o.text)?100:words(o.text.toLowerCase()).filter(w=>terms.has(w)).length}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.index-a.index).slice(0,6).map(x=>x.o);
}
export function disposeSessionMemory(memory:SessionMemory):void {
  memory.disposed=true;memory.summary="";memory.messages=[];memory.roster=[];memory.answerExamples=[];memory.acceptedOutputs=[];
  memory.establishedAiFacts=[];memory.chatterProfiles={};memory.playerStances={};memory.processedMessageIds.clear();memory.visibleAnswerKeys.clear();memory.summarizedThroughMessageId=null;memory.revision++;
}
