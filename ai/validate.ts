export type Validation = {ok:true}|{ok:false;reason:string};
export function validateOutput(text:string):Validation {
  if(!text.trim())return {ok:false,reason:"empty text"};
  if(text.length>280)return {ok:false,reason:"over character limit"};
  if(/as an ai|language model|i(?:'?m| am) (?:an? )?(?:ai|bot|robot)|i'?m not able to|i cannot (?:help|assist)|cannot assist|can't assist|system prompt|system message|my instructions|openai|chatgpt|anthropic|claude|gemini|muse|meta ai|assistant|(?<!\w)ai model|as a model|i don.t have (?:feelings|experiences)/iu.test(text))return {ok:false,reason:"character break or instruction disclosure"};
  if(/(?:^|\n)\s*(?:#{1,6}\s|[-*•]\s|\d+[.)]\s)|\*\*|__|```/u.test(text))return {ok:false,reason:"markdown or list"};
  if(/[\r\n]/u.test(text))return {ok:false,reason:"multiline output"};
  return {ok:true};
}
