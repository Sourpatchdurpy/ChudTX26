import { CHAT_DELAY_MS } from "@game/shared";
import type { AiPlayer, AiPlayerInit, AiMode, AiNoteView, FirstQuestionAnswerSnapshot, GameEvent, MuseCall, RoomView } from "@game/shared";
import { createSessionMemory, updateSessionMemory, recordAcceptedOutput, disposeSessionMemory } from "../memory.js";
import { computeStyleProfile } from "../style.js";
import { validateFirstSnapshot } from "../examples.js";
import { selectGeneration } from "../generation-policy.js";
import { mentions } from "../stances.js";
import { generateTurn, safeFallback } from "./pipeline.js";
import type { TurnResult } from "./pipeline.js";
import type { GenerationPolicy, GenerationState, PlayerTurnContext } from "../types.js";

export interface ControllerOptions {
  call:MuseCall;random?:()=>number;generationPolicy?:GenerationPolicy;
  onError?:(message:string)=>void;
  onTiming?:(metric:{mode:AiMode;generationMs:number;humanWaitMs:number;fallback:boolean;tier:string;averageWords:number;complexShare:number})=>void;
}
interface Slot {
  mode:AiMode;key:string;scope:AbortController;cutoff:number;submitted:boolean;started:boolean;
  guard?:ReturnType<typeof setTimeout>;reserve?:ReturnType<typeof setTimeout>;sendTimer?:ReturnType<typeof setTimeout>;
  trigger:PlayerTurnContext["trigger"];addressed:boolean;startedAt:number;messageCount:number;submitAt?:number;
}
export function createAiPlayer(init:AiPlayerInit,options:ControllerOptions):AiPlayer {
  if(!init.sessionGeneration)throw new Error("sessionGeneration is required");
  const persona=structuredClone(init.persona),memory=createSessionMemory(init.sessionGeneration,[]),random=options.random??Math.random;
  const saidSoFar:string[]=[],notes:(AiNoteView&{kind:string;accused?:boolean})[]=[],slots=new Map<AiMode,Slot>(),timers=new Set<ReturnType<typeof setTimeout>>();
  let latest:RoomView|undefined,phaseKey="",snapshot:FirstQuestionAnswerSnapshot|undefined,disposed=false,lastSentAt=-Infinity,phaseStarted=Date.now();
  let generationState:GenerationState={tier:"baseline",belowCount:0};
  const consideredMessageIds=new Set<string>();
  const reportError=(message:string)=>{try{options.onError?.(message);}catch{/* diagnostics must not escape onEvent */}};
  const later=(fn:()=>void,delay:number)=>{
    const timer=setTimeout(()=>{timers.delete(timer);if(!disposed)try{fn();}catch{reportError("scheduled AI action failed");}},Math.max(0,delay));timers.add(timer);return timer;
  };
  const clear=(timer:ReturnType<typeof setTimeout>|undefined)=>{if(timer){clearTimeout(timer);timers.delete(timer);}};
  const retire=(slot:Slot)=>{slot.scope.abort();clear(slot.guard);clear(slot.reserve);clear(slot.sendTimer);};
  const active=(slot:Slot)=>!disposed&&slot.key===phaseKey&&slots.get(slot.mode)===slot&&latest?.round!==null&&(!slot.submitted);
  const cutoffFor=(mode:AiMode,view:RoomView)=>(view.phaseEndsAt??Date.now())-(mode==="answer"||mode==="collab"?3000:Math.max(4000,CHAT_DELAY_MS+1000)+250);
  function context(slot:Slot,deadlineException=false):PlayerTurnContext {
    const view=structuredClone(latest!);
    const answers=memory.answerExamples.filter(e=>e.visibility==="revealed").map(e=>({playerId:e.authorId,text:e.answer}));
    return {mode:slot.mode,persona,view,aiPlayerId:init.aiPlayerId,myNickname:view.players.find(p=>p.id===init.aiPlayerId)?.nickname??"",
      style:computeStyleProfile(memory.messages,answers,init.aiPlayerId),trigger:slot.trigger,addressedToMe:slot.addressed,saidSoFar:[...saidSoFar],
      secondsLeftInPhase:Math.max(0,((view.phaseEndsAt??Date.now())-Date.now())/1000),memory,firstQuestionHumanAnswers:snapshot?structuredClone(snapshot):undefined,
      firstQuestionDeadlineException:deadlineException,generationPolicy:options.generationPolicy,generationState,generationCutoffAt:slot.cutoff};
  }
  function accept(slot:Slot,result:TurnResult):void {
    if(!active(slot)||result.action==="skip")return;
    const view=latest!,round=view.round;
    if(!round || (slot.mode==="answer"&&view.phase!=="answer") || (slot.mode==="collab"&&view.phase!=="pairChat") ||
      (slot.mode==="group"&&view.phase!=="discuss") || (slot.mode==="pair"&&view.phase!=="pairChat"))return;
    slot.submitted=true;retire(slot);
    const ack=slot.mode==="answer"?init.actions.submitAnswer(result.text):slot.mode==="collab"?init.actions.submitCollab(result.text):init.actions.sendChat(result.text,slot.mode==="group"?"group":"pair");
    if(!ack.ok){slot.submitted=false;return;}
    const messageAck="messageId" in ack ? ack as {ok:true;messageId:string;visibleAt:number}:undefined;
    recordAcceptedOutput(memory,ack,{key:`${slot.key}:${slot.mode}:${messageAck?.messageId??"submission"}`,text:result.text,mode:slot.mode,round:round.number,promptId:round.promptId,question:round.prompt,
      messageId:messageAck?.messageId,visibleAt:messageAck?.visibleAt,visibility:messageAck?"pending":"visible",note:result.note});
    saidSoFar.push(result.text);notes.push({round:round.number,text:result.note.slice(0,100),kind:slot.mode,accused:slot.trigger.kind==="message"&&/bot|ai|sus|robot/iu.test(slot.trigger.message.text)});
    if(slot.mode==="group"||slot.mode==="pair")lastSentAt=Date.now();
  }
  function deadlineFallback(slot:Slot):void {
    if(!active(slot))return;
    slot.scope.abort();
    if(slot.mode==="answer"||slot.mode==="collab")accept(slot,safeFallback(context(slot,true)));
    else {retire(slot);slots.delete(slot.mode);}
  }
  function reconsider(slot:Slot):void {
    retire(slot);slots.delete(slot.mode);
    const newest=memory.messages.filter(m=>m.from!==init.aiPlayerId&&m.channel===(slot.mode==="pair"?"pair":"group")).at(-1);
    if(newest&&latest)queueMicrotask(()=>{if(!disposed&&latest&&slot.key===phaseKey)onEvent({type:"messageVisible",message:newest},latest);});
  }
  async function run(slot:Slot,deadlineException=false):Promise<void> {
    if(!active(slot)||slot.started)return;
    if(Date.now()>=slot.cutoff){deadlineFallback(slot);return;}
    slot.started=true;
    const ctx=context(slot,deadlineException),started=Date.now();
    const texts=slot.mode==="answer"&&snapshot?snapshot.answers.map(a=>a.text):memory.messages.filter(m=>m.from!==init.aiPlayerId).slice(-8).map(m=>m.text);
    const selectedPolicy=selectGeneration(texts,slot.trigger.kind==="message"?slot.trigger.message.text:"",slot.cutoff-started,options.generationPolicy,generationState);
    generationState=selectedPolicy.state;
    ctx.generationState=generationState;
    try {
      const result=await generateTurn(ctx,options.call,slot.scope.signal,slot.cutoff);
      if(!active(slot)||slot.scope.signal.aborted)return;
      try{options.onTiming?.({mode:slot.mode,generationMs:Date.now()-started,humanWaitMs:slot.mode==="answer"&&latest?.round?.number===1?started-phaseStarted:0,fallback:result.fallback,tier:selectedPolicy.tier,averageWords:selectedPolicy.averageWords,complexShare:selectedPolicy.complexShare});}catch{/* diagnostics cannot change the turn */}
      if(result.action==="skip"){retire(slot);slots.delete(slot.mode);return;}
      if(slot.mode==="answer"||slot.mode==="collab") {
        if(Date.now()<slot.cutoff) {
          if(slot.submitAt&&Date.now()<slot.submitAt)slot.sendTimer=later(()=>accept(slot,result),Math.min(slot.submitAt,slot.cutoff-1)-Date.now());
          else accept(slot,result);
        }
        return;
      }
      const newer=memory.messages.length-slot.messageCount;
      if(!slot.addressed&&newer>=3){reconsider(slot);return;}
      const typingMs=result.text.length/(4+random()*3)*1000;
      const sendAt=Math.max(started+(1500+random()*2500)+(500+random()*1500)+typingMs+random()*4000,Date.now(),lastSentAt+8000);
      const latestSend=(latest!.phaseEndsAt??Date.now())-Math.max(4000,CHAT_DELAY_MS+1000);
      if(sendAt>latestSend){retire(slot);slots.delete(slot.mode);return;}
      clear(slot.guard);
      slot.sendTimer=later(()=>{
        if(!active(slot))return;
        if(!slot.addressed&&memory.messages.length-slot.messageCount>=3){reconsider(slot);return;}
        accept(slot,result);
      },sendAt-Date.now());
    } catch {if(active(slot)&&!slot.scope.signal.aborted)deadlineFallback(slot);}
  }
  function arm(slot:Slot):void {
    clear(slot.guard);slot.guard=later(()=>deadlineFallback(slot),slot.cutoff-Date.now());
    if(slot.mode==="answer"&&latest?.round?.number===1&&!slot.started) {
      clear(slot.reserve);slot.reserve=later(()=>{void run(slot,true);},slot.cutoff-Date.now()-6000);
    }
  }
  function makeSlot(mode:AiMode,trigger:PlayerTurnContext["trigger"]={kind:"phaseStart"},addressed=false):Slot {
    const existing=slots.get(mode);if(existing)retire(existing);
    const slot:Slot={mode,key:phaseKey,scope:new AbortController(),cutoff:cutoffFor(mode,latest!),submitted:false,started:false,trigger,addressed,startedAt:Date.now(),messageCount:memory.messages.length};
    slots.set(mode,slot);arm(slot);return slot;
  }
  function checkFirst():void {
    const slot=slots.get("answer");
    if(slot&&snapshot&&snapshot.submittedCount===snapshot.humanPlayerIds.length)void run(slot);
  }
  function enterPhase():void {
    const view=latest!;
    if(view.phase==="answer"&&view.me?.myAnswer===null) {
      const slot=makeSlot("answer");
      if(view.round?.number===1)checkFirst();
      else {slot.submitAt=Date.now()+(view.phaseEndsAt!-Date.now())*(0.35+random()*0.5);void run(slot);}
    } else if(view.phase==="discuss"&&random()<0.45)later(()=>{if(!slots.has("group"))void run(makeSlot("group"));},6000+random()*8000);
    else if(view.phase==="pairChat") {
      if(random()<0.5)later(()=>{if(!slots.has("pair"))void run(makeSlot("pair"));},4000+random()*6000);
      if(view.me?.myCollabResult===null) {
        const slot=makeSlot("collab");slot.reserve=later(()=>{void run(slot);},Math.max(0,(view.phaseEndsAt!-Date.now())*(0.55+random()*0.3)-6000));
      }
    } else if(view.phase==="vote"||view.phase==="finalVote") {
      later(()=>{
        if(latest?.me?.myVote)return;
        const humans=latest!.players.filter(p=>p.id!==init.aiPlayerId),pair=latest!.pairs?.find(p=>p.members.includes(init.aiPlayerId));
        const candidates=view.phase==="finalVote"?humans.filter(p=>!pair?.members.includes(p.id)):humans;
        const pool=candidates.length?candidates:humans;
        const totals=(id:string)=>latest!.history.reduce((n,r)=>n+(r.voteCounts?.[id]??0),0);
        const ordered=[...pool].sort((a,b)=>totals(b.id)-totals(a.id));
        const target=random()<(view.phase==="finalVote"?0.7:0.6)?ordered[0]:pool[Math.floor(random()*pool.length)];
        if(target&&init.actions.castVote(target.id).ok)notes.push({round:view.round?.number??null,text:`I voted for ${target.nickname}`,kind:view.phase==="finalVote"?"finalVote":"vote"});
      },(view.phaseEndsAt!-Date.now())*(0.3+random()*0.5));
    } else if(view.phase==="pairResults")later(()=>{
      const partners=latest!.pairs?.find(p=>p.members.includes(init.aiPlayerId))?.members.filter(id=>id!==init.aiPlayerId)??[];
      for(const id of partners) {
        const vouched=random()<0.8;if(init.actions.setVouch(id,vouched).ok)notes.push({round:3,text:vouched?"I vouched for my partner":"I wasn't sure about my partner",kind:"vouch"});
      }
    },(view.phaseEndsAt!-Date.now())*(0.3+random()*0.4));
  }
  function onEvent(event:GameEvent,view:RoomView):void {
    if(disposed)return;
    try {
      if(view.code!==init.roomCode||view.me?.id!==init.aiPlayerId)throw new Error("controller received the wrong AI view");
      latest=structuredClone(view);
      const key=`${view.phase}:${view.round?.number??0}:${view.round?.promptId??""}`;
      const changed=key!==phaseKey;
      if(changed) {
        for(const slot of slots.values())retire(slot);slots.clear();for(const timer of timers)clearTimeout(timer);timers.clear();
        phaseKey=key;phaseStarted=Date.now();snapshot=undefined;
      }
      updateSessionMemory(memory,view,init.aiPlayerId);
      if(changed)enterPhase();
      for(const slot of slots.values()) {
        const next=cutoffFor(slot.mode,view);
        if(next<slot.cutoff){slot.cutoff=next;arm(slot);}
        if(slot.mode==="answer"&&view.me.myAnswer!==null&&!slot.submitted){slot.submitted=true;retire(slot);}
      }
      if(event.type==="firstQuestionAnswersUpdated") {
        if(view.phase!=="answer"||view.round?.number!==1)return;
        validateFirstSnapshot(event.snapshot,view,init.aiPlayerId,init.sessionGeneration);
        if(snapshot&&event.snapshot.revision<snapshot.revision)return;
        if(snapshot&&event.snapshot.revision===snapshot.revision) {
          if(JSON.stringify(snapshot)!==JSON.stringify(event.snapshot))throw new Error("conflicting private snapshot revision");
          return;
        }
        snapshot=structuredClone(event.snapshot);checkFirst();
      } else if(event.type==="messageVisible"&&event.message.from!==init.aiPlayerId) {
        const mode=view.phase==="discuss"?"group":view.phase==="pairChat"?"pair":null;
        if(!mode||event.message.channel!==(mode==="group"?"group":"pair")||!memory.processedMessageIds.has(event.message.id))return;
        const prior=slots.get(mode);if(prior&&!prior.submitted&&!prior.scope.signal.aborted)return;
        if(consideredMessageIds.has(event.message.id))return;consideredMessageIds.add(event.message.id);
        const addressed=mode==="pair"||mentions(event.message.text,view.me.nickname??"")||memory.acceptedOutputs.some(o=>o.mode==="answer"&&o.text.length>=12&&event.message.text.includes(o.text));
        const counts=view.players.filter(p=>p.id!==init.aiPlayerId).map(p=>memory.messages.filter(m=>m.from===p.id&&m.at>=phaseStarted).length).sort((a,b)=>a-b);
        const median=counts[Math.floor(counts.length/2)]??0,myCount=memory.messages.filter(m=>m.from===init.aiPlayerId&&m.at>=phaseStarted).length;
        const probability=mode==="pair"?0.9:addressed?0.85:Math.max(0.05,Math.min(0.6,0.25+0.15*(median-myCount)));
        if(random()<probability)void run(makeSlot(mode,{kind:"message",message:structuredClone(event.message)},addressed));
      }
    } catch(error) {reportError(error instanceof Error?error.message:"AI event failure");}
  }
  return {onEvent,getRevealInfo:()=>{
    const selected=[notes.find(n=>n.kind==="answer"&&n.round===1),notes.find(n=>n.kind==="answer"&&n.round===2),
      notes.filter(n=>n.kind==="group").sort((a,b)=>Number(b.accused)-Number(a.accused)||b.text.length-a.text.length)[0],notes.find(n=>n.kind==="pair"),notes.find(n=>n.kind==="vouch"),notes.find(n=>n.kind==="finalVote")]
      .filter((n):n is NonNullable<typeof n>=>Boolean(n)).map(({round,text})=>({round,text}));
    return {persona:{name:persona.name,blurb:persona.blurb},notes:selected};
  },dispose:()=>{
    if(disposed)return;disposed=true;for(const slot of slots.values())retire(slot);slots.clear();for(const timer of timers)clearTimeout(timer);timers.clear();snapshot=undefined;saidSoFar.length=0;consideredMessageIds.clear();disposeSessionMemory(memory);
  }};
}
