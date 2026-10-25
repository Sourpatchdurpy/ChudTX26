import { analyze, sentenceCounts, words } from "./analysis.js";
import type { GenerationPolicy, GenerationState, TierName } from "./types.js";

export const BASELINE_POLICY:GenerationPolicy={approved:["baseline"],evaluated:["baseline"],p90Ms:{baseline:6000,expanded:8000,complex:11000,high:15000}};
export const TIERS={baseline:{reasoning_effort:"minimal",max_completion_tokens:800},expanded:{reasoning_effort:"low",max_completion_tokens:1600},complex:{reasoning_effort:"medium",max_completion_tokens:3000},high:{reasoning_effort:"high",max_completion_tokens:4096}} as const;
const order:TierName[]=["baseline","expanded","complex","high"];
export function selectGeneration(texts:string[],trigger:string,remainingMs:number,policy:GenerationPolicy=BASELINE_POLICY,state:GenerationState={tier:"baseline",belowCount:0}) {
  const recent=texts.slice(-8), stats=analyze(recent);
  const averageWords=recent.length?stats.totalWords/recent.length:0;
  const complexShare=recent.length?recent.filter(t=>sentenceCounts(t).sentences>1||(t.match(/\?/gu)?.length??0)>1).length/recent.length:0;
  const multi=(trigger.match(/\?/gu)?.length??0)>1 || /\b(?:contradict|earlier you said|both .* and)\b/iu.test(trigger)&&words(trigger).length>=25;
  let desired:TierName="baseline";
  if(recent.length>=5||multi) {
    if((averageWords>=40&&complexShare>=0.5)||multi)desired="complex";
    else if(averageWords>=25||complexShare>=0.5)desired="expanded";
  }
  if(desired==="complex"&&policy.highEscalation)desired="high";
  let next={...state};
  if(order.indexOf(desired)<order.indexOf(state.tier)) {
    next.belowCount++;if(next.belowCount<3)desired=state.tier;
  } else next.belowCount=0;
  const fitting=order.filter(t=>order.indexOf(t)<=order.indexOf(desired)&&policy.approved.includes(t)&&policy.evaluated.includes(t)&&policy.p90Ms[t]<=remainingMs);
  const tier=fitting.at(-1)??"baseline";next.tier=tier;
  return {tier,...TIERS[tier],averageWords,complexShare,sampleCount:recent.length,state:next,fits:policy.p90Ms[tier]<=remainingMs};
}
