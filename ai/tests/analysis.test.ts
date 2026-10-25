import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, sentenceCounts, words, commonTokens } from "../analysis.js";
import { computeStyleProfile,computeChatterProfiles } from "../style.js";
import { message } from "../fixtures/scenarios.js";

const sentences:[string,number,number][]=[
  ["hi. how are you?",2,1],["hi. how are you",2,1],["hi",1,0],["hi. bye.",2,2],['"hi."',1,1],["wait... really?",2,1],["version 3.14 works",1,0],["Dr. Lee is here.",1,1],["😂",0,0],["",0,0],
  ["mail a.b@example.com then wait",1,0],["https://example.com.",1,0],["e.g. that works",1,0],["hello… really?!",2,0],["line one\nline two.",2,1],["Mr. A. B. went home.",1,1],["at 8 a.m. then lunch",1,0],["©️",0,0]
];
for(const [text,total,period] of sentences)test(`sentence segmentation ${JSON.stringify(text)}`,()=>assert.deepEqual(sentenceCounts(text),{sentences:total,periodSentences:period}));
test("Unicode words, apostrophes, underscores, numerals and casing",()=>{
  assert.deepEqual(words("don't rock’n’roll café_東京 123 💀"),["don't","rock’n’roll","café","東京","123"]);
  const a=analyze(["hi I 123","don't 😂","", "Café 東京"]);
  assert.deepEqual(a.wordCounts,[3,1,0,2]);assert.equal(a.medianWords,1.5);assert.equal(a.lowercaseWords,2);assert.equal(a.lowercaseWordRatio,2/6);assert.equal(a.emojiMessageRatio,1/4);
});
test("ratios aggregate denominators rather than participant percentages",()=>{
  const a=analyze(["hi. how are you?","hi. bye."]);assert.equal(a.periodSentenceRatio,3/4);
  assert.equal(analyze([]).periodSentenceRatio,0);assert.equal(analyze(["😂"]).totalWords,0);
});
test("emoji presence mirrors Python ranges including keycaps and text symbols",()=>{
  for(const text of ["👩🏽‍💻","🇺🇸","1️⃣","☀","©️","😭💀"])assert.equal(analyze([text]).emojiMessageRatio,1,text);
  for(const text of ["123","©","™","plain"])assert.equal(analyze([text]).emojiMessageRatio,0,text);
});
test("AI exclusion, duplicate messages, null answers and real empty observations",()=>{
  const m=message("one","HI 💀");const profiles=computeChatterProfiles([m,m,message("ai","lots of WORDS","ai")],[{playerId:"h1",text:null},{playerId:"h2",text:""}],"ai");
  assert.equal(profiles.h1!.sampleCount,1);assert.equal(profiles.h2!.sampleCount,1);assert.equal(profiles.h2!.medianWords,0);assert.equal(profiles.ai,undefined);
});
test("shared legacy trailing periods are separate from sentence period measurement",()=>{
  const msgs=[message("1","hi. how are you?")];
  assert.equal(computeStyleProfile(msgs,[],"ai").endsWithPeriodRatio,0);assert.equal(computeChatterProfiles(msgs,[],"ai").h1!.periodSentenceRatio,0.5);
  assert.equal(computeStyleProfile([],[],"ai").medianChars,40);
  assert.deepEqual(commonTokens(["lol fr 💀","fr lol"]),["fr","lol","💀"]);
});
