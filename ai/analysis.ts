import type { Measurements } from "./types.js";

export const words = (text: string): string[] => text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
// Deliberately mirrors message_analysis.py, including text-style symbols.
export const emojiPattern = /[\u{1F000}-\u{1FAFF}\u2600-\u26FF\u2700-\u27BF\u231A\u231B\u23E9-\u23F3\u23F8-\u23FA\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|[©®™↔-↙↩↪‼⁉ℹ〰]\uFE0F|[#*0-9]\uFE0F?\u20E3/u;
export const graphemes = (text: string): string[] => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), x => x.segment);
export const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a,b) => a-b), n = sorted.length;
  return n ? (sorted[Math.floor((n-1)/2)]! + sorted[Math.floor(n/2)]!)/2 : 0;
};
export const ratio = (a: number, b: number): number => b ? a/b : 0;

/** Protected spans are masked without changing positions. URLs include final dots. */
export function sentenceCounts(text: string): { sentences: number; periodSentences: number } {
  const protectedAt = new Set<number>();
  const spans = /https?:\/\/[^\s<>"“”]+|www\.[^\s<>"“”]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\d+(?:\.\d+)+|\b(?:mr|mrs|ms|dr|prof)\.|\b(?:e\.g\.|i\.e\.|a\.m\.|p\.m\.)|\b(?:[a-z]\.[ \t]*){2,}/giu;
  for (const m of text.matchAll(spans)) for (let i=m.index;i<m.index+m[0].length;i++) protectedAt.add(i);
  let start=0, sentences=0, periodSentences=0;
  const finish = (end: number, period: boolean) => {
    if (words(text.slice(start,end)).length) { sentences++; if (period) periodSentences++; }
    start=end;
  };
  for (let i=0;i<text.length;i++) {
    if (text[i] === "\n") { finish(i+1,false); continue; }
    if (protectedAt.has(i) || !/[.!?…]/u.test(text[i]!)) continue;
    let end=i+1;
    while (end<text.length && !protectedAt.has(end) && /[.!?…]/u.test(text[end]!)) end++;
    const period=text[end-1] === ".";
    let close=end;
    while (close<text.length && /["'”’\])}]/u.test(text[close]!)) close++;
    if (close === text.length || /\s/u.test(text[close]!)) { finish(close,period); i=close-1; }
    else i=end-1;
  }
  finish(text.length,false);
  return { sentences, periodSentences };
}
export function analyze(texts: string[]): Measurements {
  const wordCounts: number[]=[];
  let totalWords=0, lowercaseWords=0, sentences=0, periodSentences=0, emojiMessages=0;
  for (const text of texts) {
    const ws=words(text); wordCounts.push(ws.length); totalWords+=ws.length;
    lowercaseWords+=ws.filter(w => w.toLowerCase()===w && w.toUpperCase()!==w).length;
    const s=sentenceCounts(text); sentences+=s.sentences; periodSentences+=s.periodSentences;
    emojiMessages+=Number(emojiPattern.test(text));
  }
  return { sampleCount:texts.length, wordCounts, medianWords:median(wordCounts), minWords:wordCounts.length?Math.min(...wordCounts):0,
    maxWords:wordCounts.length?Math.max(...wordCounts):0, totalWords, lowercaseWords, lowercaseWordRatio:ratio(lowercaseWords,totalWords),
    sentences, periodSentences, periodSentenceRatio:ratio(periodSentences,sentences), emojiMessages, emojiMessageRatio:ratio(emojiMessages,texts.length) };
}
const tokens=["lol","lmao","fr","ngl","tbh","idk","bro","bruh","lowkey","highkey","deadass","💀","😭"];
export function commonTokens(texts: string[]): string[] {
  const counts=new Map<string,number>();
  for (const text of texts) for (const t of tokens) {
    const count=t.codePointAt(0)!>0xffff ? text.split(t).length-1 : words(text.toLowerCase()).filter(w=>w===t).length;
    counts.set(t,(counts.get(t)??0)+count);
  }
  return [...counts].filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1] || (a[0]<b[0]?-1:1)).slice(0,8).map(([t])=>t);
}
