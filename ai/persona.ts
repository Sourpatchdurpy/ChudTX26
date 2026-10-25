import type { MuseCall, Persona, WorldContext } from "@game/shared";
import { fallbackPersona } from "./fallback-personas.js";
import { normalizePersona, personaSchema, responseFormat } from "./schemas.js";

export async function generatePersona(world:WorldContext,call:MuseCall):Promise<Persona> {
  try {
    const result=await call<unknown>({messages:[
      {role:"developer",content:"Invent one complete fictional person aged 18–24 for a social deduction game. Do not generate a name or a name field. The game assigns a nickname separately. Do not invent a personal name anywhere in the blurb, facts or other persona fields. Never impersonate a real person. Student enrollment or event attendance is optional. Return strict JSON. Required facts cover occupation/current life situation, living situation, routine, hobbies, favorite food/order, disliked food, dietary preference and a few small anecdotes. Include at least two detailed hobbies, three low-stakes opinions and 2–4 everyday activities this week. Use nullable education fields for nonstudents. Never include hackathonStory or extra. Blurb must describe this person's age, life situation and interests without a personal name. Distinguish supplied external facts from fictional anecdotes; do not invent headlines/weather/event attendance or claim future scheduled events happened. Keep strangers comfortable. Vary occupation, voice and interests."},
      {role:"user",content:JSON.stringify({world,task:"Create the fact sheet. Missing current information means ordinary everyday activities only."})}
    // 2000: at "low" effort Muse spent 905 of 1000 tokens reasoning and cut the JSON off (real test, Oct 25).
    ],response_format:responseFormat("persona",personaSchema),reasoning_effort:"low",max_completion_tokens:2000});
    return normalizePersona(result);
  } catch { return fallbackPersona(); }
}
