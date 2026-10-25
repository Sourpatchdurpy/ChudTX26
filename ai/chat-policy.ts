import type {ChatMessage} from "@game/shared";

/** Mentions alone need no answer; explicit questions and clarification requests do. */
export function asksForChatReply(text:string):boolean {
  return /\?|\b(?:what(?:s)?|why|how|where|when|which|who|explain|tell (?:me|us)|you said|earlier you|contradict\w*|doesn.t add up|does not add up|even real)\b/iu.test(text);
}

export function isEmptyDefense(text:string):boolean {
  const normalized=text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
  return /^(?:lol |lmao |nah |nope )*(?:me|not me|i don t see it|what gave you that idea|bro what|wait what|why me|no|nope|nah|i (?:m|am) not (?:a |the )?(?:bot|ai|robot))$/u.test(normalized);
}

/** Exact, low-information acknowledgements. Questions and substantive sentences pass through. */
export function isLowValueChat(text:string,nickname="",includeAgreement=true):boolean {
  if(isResolutionMessage(text,nickname))return true;
  if(/\?|\b(?:what|why|how|where|when|which|explain)\b/iu.test(text))return false;
  const escaped=nickname.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&");
  const withoutName=escaped?text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])@?${escaped}(?![\\p{L}\\p{N}_])`,"giu")," "):text;
  const words=withoutName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
  if(/^(?:(?:oh |aww? |ok |okay )?(?:thanks(?: a lot)?|thank you(?: so much)?|ty|thx)(?: i appreciate (?:it|that))?|i appreciate (?:it|that)|(?:that (?:is|was) (?:a )?)?(?:nice|good|great|solid|cool)(?: answer| one)?|i trust(?: you)?|(?:you (?:are|seem)|is|seems) human|(?:isn t|is not|you aren t|you are not|not) (?:the |a |an )?(?:bot|ai|robot))$/u.test(words))return true;
  return includeAgreement&&/^(?:lol|lmao|haha|yeah|yes|yep|ok|okay|same|same here|yeah fair|fair enough|i agree|i can see that)$/u.test(words);
}
export function isResolutionMessage(text:string,nickname=""):boolean {
  const words=text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
  const name=nickname.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
  if(name&&words===`i trust ${name}`)return true;
  return /^(?:ok |okay |yeah )?(?:never mind|nevermind|i take it back|that makes sense|makes sense|that explains it|fair enough|i trust you|you re right|you are right)$/u.test(words);
}

/** Only the original speaker can resolve their own question or accusation. */
export function isResolvedChat(trigger:ChatMessage,messages:readonly ChatMessage[],nickname:string):boolean {
  const index=messages.findIndex(m=>m.id===trigger.id);
  if(index<0)return false;
  const latest=messages.slice(index+1).filter(m=>m.from===trigger.from&&m.channel===trigger.channel&&m.pairId===trigger.pairId).at(-1);
  return Boolean(latest&&isResolutionMessage(latest.text,nickname));
}

