import type { PlayerTurnContext } from "./types.js";

// Conversational fillers, not ordinary content words or grammatical openings.
const EXPRESSIONS = ["lol", "lmao", "haha", "tbh", "ngl", "honestly", "literally", "lowkey", "i mean", "not gonna lie", "to be honest"];
const normalize = (text:string) => text.toLowerCase().replace(/[’']/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const contains = (text:string, expression:string) => ` ${normalize(text)} `.includes(` ${expression} `);
const opensWith = (text:string, expression:string) => {
  const normalized=normalize(text);
  return normalized===expression || normalized.startsWith(`${expression} `);
};

/** Only this AI's accepted output counts; human habits must not become a catchphrase. */
export function expressionGuidance(ctx:PlayerTurnContext) {
  const accepted=ctx.memory?.acceptedOutputs;
  const history=accepted?.length ? accepted.map(o=>o.text) : ctx.saidSoFar.length ? ctx.saidSoFar :
    (ctx.memory?.messages??ctx.view.messages).filter(m=>m.from===ctx.aiPlayerId).map(m=>m.text);
  const recent=history.slice(-4);
  return {avoidExpressions:EXPRESSIONS.filter(expression=>
    (recent.length>0 && opensWith(recent.at(-1)!,expression)) || recent.filter(text=>contains(text,expression)).length>=2)};
}

export function repeatedExpression(text:string,ctx:PlayerTurnContext):string|undefined {
  return expressionGuidance(ctx).avoidExpressions.find(expression=>contains(text,expression));
}
