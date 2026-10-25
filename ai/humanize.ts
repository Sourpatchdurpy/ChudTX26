import type { Persona, StyleProfile } from "@game/shared";
import { emojiPattern, graphemes } from "./analysis.js";

export function humanize(text:string,style:StyleProfile,persona:Persona):string {
  let out=text.trim().replace(/^(?:["“])([\s\S]*)(?:["”])$/u,"$1").replace(/\s+/gu," ");
  out=out.replace(/\s*[—–]\s*/gu,", ").replace(/;\s*/gu,", ");
  const first=out.match(/^[\p{L}]+/u)?.[0];
  // Only ordinary sentence starters are safe without a proper-name lexicon.
  const ordinary=/^(?:The|This|That|Yeah|Yes|No|Maybe|My|It|We|Well|Honestly|Probably|Same|Wait|Also|But|So)$/u;
  if(style.lowercaseStartRatio>0.6 && first && ordinary.test(first) && !persona.name.split(/\s/u).includes(first))out=first.toLowerCase()+out.slice(first.length);
  if(style.endsWithPeriodRatio<0.3 && /\.$/u.test(out) && !/(?:https?:\/\/\S+|www\.\S+|\b(?:mr|mrs|ms|dr|prof)|\b(?:[a-z]\.)+[a-z]|\d+(?:\.\d+)*)\.$/iu.test(out))out=out.slice(0,-1);
  let emojiCount=0;
  const maxEmoji=style.emojiPerMessage<0.1?0:1;
  out=graphemes(out).filter(g=>!emojiPattern.test(g)||++emojiCount<=maxEmoji).join("").trim();
  return out;
}
