import { LIMITS } from "@game/shared";
import type { AiMode, MuseChatRequest, Persona } from "@game/shared";

type Schema = Record<string, unknown>;
const str=(maxLength?:number):Schema=>({type:"string",...(maxLength?{maxLength}:{})});
const arr=(minItems:number,maxItems?:number):Schema=>({type:"array",items:str(),minItems,...(maxItems?{maxItems}:{})});
const object=(properties:Record<string,Schema>):Schema=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
export const personaSchema=object({age:{type:"integer",minimum:18,maximum:24},
  school:{type:["string","null"]},year:{type:["string","null"]},major:{type:["string","null"]},hometown:str(),
  interests:arr(2),opinions:arr(3),facts:arr(8),thisWeek:arr(2,4),blurb:str(180)});
export function outputSchema(mode:AiMode):Schema {
  return mode==="answer"?object({answer:str(LIMITS.answerMaxChars),note:str(100)}):mode==="collab"?object({result:str(LIMITS.collabMaxChars),note:str(100)}):
    object({action:{type:"string",enum:["send","skip"]},message:str(LIMITS.chatMaxChars),note:str(100)});
}
export function responseFormat(name:string,schema:Schema):MuseChatRequest["response_format"] {
  return {type:"json_schema",json_schema:{name,strict:true,schema}};
}
/** Validates parsed objects only. No provider-envelope handling or second parse. */
export function schemaError(value:unknown,schema:Schema,path="output"):string|null {
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  const type=value===null?"null":Array.isArray(value)?"array":typeof value;
  if (!types.includes(type) && !(types.includes("integer") && typeof value==="number" && Number.isInteger(value))) return `${path}: wrong type`;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${path}: invalid enum`;
  if (typeof value==="string" && typeof schema.maxLength==="number" && value.length>schema.maxLength) return `${path}: too long`;
  if (typeof value==="number" && (!Number.isFinite(value) || (typeof schema.minimum==="number" && value<schema.minimum) || (typeof schema.maximum==="number" && value>schema.maximum))) return `${path}: out of range`;
  if (Array.isArray(value)) {
    if ((typeof schema.minItems==="number" && value.length<schema.minItems)||(typeof schema.maxItems==="number" && value.length>schema.maxItems)) return `${path}: wrong array length`;
    for(let i=0;i<value.length;i++) {const e=schemaError(value[i],schema.items as Schema,`${path}[${i}]`);if(e)return e;}
  } else if (value!==null && typeof value==="object") {
    const props=schema.properties as Record<string,Schema>, obj=value as Record<string,unknown>;
    if(Object.keys(obj).some(k=>!Object.hasOwn(props,k)) || (schema.required as string[]).some(k=>!Object.hasOwn(obj,k))) return `${path}: unexpected or missing field`;
    for(const k of Object.keys(props)){const e=schemaError(obj[k],props[k]!,`${path}.${k}`);if(e)return e;}
  }
  return null;
}
export function normalizePersona(value:unknown):Persona {
  const error=schemaError(value,personaSchema);if(error)throw new Error(error);
  const p=structuredClone(value) as Persona & {school:string|null;year:string|null;major:string|null};
  for(const k of ["school","year","major"] as const) if(p[k]===null) delete p[k];
  const strings=[p.hometown,p.blurb,...p.interests,...p.opinions,...p.facts,...p.thisWeek,...[p.school,p.year,p.major].filter((s):s is string=>s!==undefined)];
  if(strings.some(s=>!s.trim()) || p.facts.some(s=>s.length>500))throw new Error("incomplete persona");
  if ((p.year || p.major) && !p.school) throw new Error("education details need a school");
  for(const values of [p.interests,p.opinions,p.facts,p.thisWeek])if(new Set(values.map(s=>s.trim().toLowerCase())).size!==values.length)throw new Error("duplicate persona details");
  return p;
}
