import type { ChatMessage, RoundAnswer, StyleProfile } from "@game/shared";
import { analyze, commonTokens, emojiPattern, graphemes, median, ratio } from "./analysis.js";
import type { ChatterProfile } from "./types.js";

function observations(messages: ChatMessage[], answers: RoundAnswer[], aiPlayerId: string) {
  return [...new Map(messages.map(m=>[m.id,m])).values()].sort((a,b)=>a.at-b.at)
    .map(m=>({playerId:m.from,text:m.text})).concat(answers.filter((a): a is {playerId:string;text:string}=>a.text!==null))
    .filter(a=>a.playerId!==aiPlayerId);
}
export function computeStyleProfile(messages: ChatMessage[], answers: RoundAnswer[], aiPlayerId: string): StyleProfile {
  const ts=observations(messages,answers,aiPlayerId).map(a=>a.text), n=ts.length;
  if (!n) return {medianChars:40,lowercaseStartRatio:0.7,endsWithPeriodRatio:0.15,emojiPerMessage:0.2,commonTokens:[],sampleMessages:[]};
  return { medianChars:median(ts.map(t=>t.length)), lowercaseStartRatio:ratio(ts.filter(t=>/^\p{Ll}/u.test(t.trim())).length,n),
    endsWithPeriodRatio:ratio(ts.filter(t=>/\.$/u.test(t.trim())).length,n),
    emojiPerMessage:ratio(ts.reduce((sum,t)=>sum+graphemes(t).filter(g=>emojiPattern.test(g)).length,0),n),
    commonTokens:commonTokens(ts),sampleMessages:ts.slice(-8) };
}
export function computeChatterProfiles(messages: ChatMessage[], answers: RoundAnswer[], aiPlayerId: string): Record<string,ChatterProfile> {
  const grouped=new Map<string,string[]>();
  for (const o of observations(messages,answers,aiPlayerId)) grouped.set(o.playerId,[...(grouped.get(o.playerId)??[]),o.text]);
  return Object.fromEntries([...grouped].map(([playerId,ts])=>[playerId,{playerId,...analyze(ts),commonTokens:commonTokens(ts),sampleMessages:ts.slice(-3),tentative:ts.length<5}]));
}
