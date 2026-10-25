import type { FirstQuestionAnswerSnapshot, RoomView } from "@game/shared";
import { words } from "./analysis.js";
import type { AnswerExample, PlayerTurnContext, SessionMemory } from "./types.js";

export function validateFirstSnapshot(snapshot:FirstQuestionAnswerSnapshot,view:RoomView,aiId:string,generation:string):void {
  const r=view.round, roster=view.players.filter(p=>p.id!==aiId);
  if(view.phase!=="answer"||r?.number!==1||snapshot.round!==1||snapshot.sessionGeneration!==generation||snapshot.promptId!==r.promptId||snapshot.question!==r.prompt)throw new Error("snapshot session/phase/prompt mismatch");
  if(!Number.isInteger(snapshot.revision)||snapshot.revision<0||snapshot.submittedCount!==snapshot.answers.length)throw new Error("invalid snapshot revision/count");
  if(snapshot.humanPlayerIds.length!==roster.length||new Set(snapshot.humanPlayerIds).size!==roster.length||roster.some(p=>!snapshot.humanPlayerIds.includes(p.id)))throw new Error("snapshot roster mismatch");
  if(new Set(snapshot.answers.map(a=>a.playerId)).size!==snapshot.answers.length||snapshot.answers.some(a=>typeof a.text!=="string"||!roster.some(p=>p.id===a.playerId&&p.nickname===a.nickname)))throw new Error("invalid answer identity");
}
export function selectExamples(ctx:PlayerTurnContext,memory:SessionMemory):AnswerExample[] {
  const round=ctx.view.round;if(!round)return [];
  if(round.number===1) {
    const snapshot=ctx.firstQuestionHumanAnswers;
    if(!snapshot) {if(ctx.firstQuestionDeadlineException)return [];throw new Error("first question requires private snapshot");}
    validateFirstSnapshot(snapshot,ctx.view,ctx.aiPlayerId,memory.sessionGeneration);
    if(snapshot.submittedCount!==snapshot.humanPlayerIds.length&&!ctx.firstQuestionDeadlineException)throw new Error("waiting for all human submissions");
    return snapshot.answers.map(a=>({sessionGeneration:memory.sessionGeneration,round:1,promptId:round.promptId,question:round.prompt,authorId:a.playerId,nickname:a.nickname,
      authorKind:"human",visibility:"submitted-not-revealed",answer:a.text,sourceKey:`${memory.sessionGeneration}:1:${a.playerId}`}));
  }
  const all=[...memory.answerExamples.filter(e=>e.round<round.number&&e.visibility==="revealed")];
  for(const o of memory.acceptedOutputs.filter(o=>o.mode==="answer"&&o.round<round.number)) {
    const sourceKey=`${memory.sessionGeneration}:${o.round}:${ctx.aiPlayerId}`;
    if(!all.some(e=>e.sourceKey===sourceKey))all.push({sessionGeneration:memory.sessionGeneration,round:o.round,promptId:o.promptId,question:o.question,authorId:ctx.aiPlayerId,nickname:ctx.myNickname,authorKind:"self",visibility:"revealed",answer:o.text,sourceKey});
  }
  const terms=new Set(words(round.prompt.toLowerCase()).filter(w=>w.length>3));
  all.sort((a,b)=>words(b.question.toLowerCase()).filter(w=>terms.has(w)).length-words(a.question.toLowerCase()).filter(w=>terms.has(w)).length||b.round-a.round||a.sourceKey.localeCompare(b.sourceKey));
  const self=all.filter(e=>e.authorKind==="self").slice(0,2), humans=all.filter(e=>e.authorKind==="human");
  const diverse:AnswerExample[]=[];
  for(const e of humans)if(!diverse.some(d=>d.authorId===e.authorId))diverse.push(e);
  return [...self,...[...diverse,...humans.filter(e=>!diverse.includes(e))].slice(0,4)];
}
