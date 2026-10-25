import type { ChatMessage, PublicPlayer } from "@game/shared";
import type { PlayerStance } from "./types.js";

export function mentions(text:string,name:string):boolean {
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])@?${escaped}(?=$|[^\\p{L}\\p{N}_])`,"iu").test(text);
}
export function computeStances(messages:ChatMessage[],roster:PublicPlayer[],aiId:string,aiName:string,selfAnswers:string[],resolvedThrough= -1):Record<string,PlayerStance> {
  const result:Record<string,PlayerStance>={};
  for(const p of roster.filter(p=>p.id!==aiId)) {
    const observations=messages.flatMap((m,index)=>{
      if(m.from!==p.id)return [];
      const quoted=selfAnswers.some(a=>a.length>=12 && (m.text.includes(`"${a}"`)||m.text.includes(`“${a}”`)));
      if(!mentions(m.text,aiName)&&!quoted)return [];
      const clauses=m.text.split(/[.!?;\n]|\bbut\b/iu).filter(c=>mentions(c,aiName));
      const targetText=quoted?m.text:clauses.join("; ");
      const t=targetText.toLowerCase();
      const ambiguous=/\/s\b|yeah right|sure buddy|sarcas/iu.test(m.text)||roster.some(p=>p.id!==aiId&&mentions(targetText,p.nickname));
      const negativeTrust=/\b(?:don['’]?t|do not|can['’]?t) trust|\bnot human/iu.test(t);
      const negatedBot=/\b(?:isn['’]?t|is not|aren['’]?t|not|is no)\s+(?:the\s+|an?\s+)?(?:bot|ai|robot|sus)/giu;
      const negatedBelief=/\b(?:don['’]?t|do not) think\b[^;]*\b(?:bot|ai|robot)\b/iu.test(t);
      const defense=negatedBot.test(t)||negatedBelief||(!negativeTrust&&/\b(?:trust|human|defend)\b/iu.test(t));
      const skepticism=(!negatedBelief&&/\b(?:bot|ai|robot|sus|suspicious|chatgpt)/iu.test(t.replace(negatedBot,"")))||negativeTrust;
      const mixed=defense&&skepticism;
      const kind=ambiguous?"unknown":mixed?"mixed":defense?"defending":skepticism?"skeptical":"neutral";
      return [{kind,index,evidence:{sourceId:m.id,quote:m.text,older:index<messages.length-8},ambiguous,question:m.text.includes("?")}];
    });
    const recent=observations.filter(o=>!o.evidence.older), explicit=observations.filter(o=>!o.ambiguous&&o.kind!=="neutral");
    const recentExplicit=recent.filter(o=>!o.ambiguous&&o.kind!=="neutral");
    const active=recentExplicit.length?recentExplicit:explicit.length?explicit.slice(-1):recent.slice(-2), kinds=new Set(active.map(o=>o.kind));
    const stance=kinds.has("mixed")||(kinds.has("skeptical")&&kinds.has("defending"))?"mixed":active.at(-1)?.kind??"unknown";
    result[p.id]={playerId:p.id,stance:stance as PlayerStance["stance"],strength:active.length?(active.some(o=>o.ambiguous)?"tentative":"explicit"):"none",
      evidence:active.slice(-2).map(o=>o.evidence),latestPosition:active.at(-1)?.index??-1,
      unresolvedQuestions:observations.filter(o=>o.question&&o.index>resolvedThrough).map(o=>o.evidence)};
  }
  return result;
}
