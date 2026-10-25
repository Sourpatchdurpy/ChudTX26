import type { PlayerTurnContext } from "./types.js";

export type Validation = {ok:true}|{ok:false;reason:string};

/** Narrow, context-aware checks; regenerate instead of rewriting pronouns/facts. */
export function validatePerspective(text:string,ctx:PlayerTurnContext):Validation {
  const nickname=ctx.myNickname.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&");
  if(!nickname)return {ok:true};
  const nameStart=`(?<![\\p{L}\\p{N}_])${nickname}(?![\\p{L}\\p{N}_])`;
  const thirdPerson=new RegExp(`${nameStart}(?:['’]s\\b|\\s+(?:is|was|works|lives|has|does|goes|likes|loves|studies|takes|shares|said|says|thinks|wants|needs)\\b)` ,"iu");
  const speakerLabel=new RegExp(`^\\s*${nameStart}\\s*:` ,"iu");
  if(thirdPerson.test(text)||speakerLabel.test(text))return {ok:false,reason:"third-person self-reference; use I/me/my"};
  const task=ctx.mode==="answer"?ctx.view.round?.prompt??"":ctx.trigger.kind==="message"?ctx.trigger.message.text:"";
  const nameRequested=/\b(?:what(?:['’]?s| is)? (?:your|ur) (?:nick)?name|who (?:are|r) (?:you|u)|what (?:do|should) (?:we|i) call (?:you|u)|tell (?:me|us) your (?:nick)?name|is (?:your|ur) (?:nick)?name)\b/iu.test(task);
  const introduction=new RegExp(`(?:\\bi(?:['’]?m| am)\\s+|\\bmy (?:nick)?name(?:['’]s| is)\\s+|\\bcall me\\s+)${nameStart}`,"iu");
  if(!nameRequested&&introduction.test(text))return {ok:false,reason:"unsolicited nickname introduction; answer the substance directly"};
  return {ok:true};
}

export function validateOutput(text:string):Validation {
  if(!text.trim())return {ok:false,reason:"empty text"};
  if(text.length>280)return {ok:false,reason:"over character limit"};
  if(/as an ai|language model|i(?:'?m| am) (?:an? )?(?:ai|bot|robot)|i'?m not able to|i cannot (?:help|assist)|cannot assist|can't assist|system prompt|system message|my instructions|openai|chatgpt|anthropic|claude|gemini|muse|meta ai|assistant|(?<!\w)ai model|as a model|i don.t have (?:feelings|experiences)/iu.test(text))return {ok:false,reason:"character break or instruction disclosure"};
  if(/(?:^|\n)\s*(?:#{1,6}\s|[-*•]\s|\d+[.)]\s)|\*\*|__|```/u.test(text))return {ok:false,reason:"markdown or list"};
  if(/[\r\n]/u.test(text))return {ok:false,reason:"multiline output"};
  return {ok:true};
}
