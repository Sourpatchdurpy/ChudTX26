import { analyze } from "../analysis.js";
import { selectExamples } from "../examples.js";
import type { PlayerTurnContext, SessionMemory } from "../types.js";

export const QUESTION_ANSWER_VERSION="qa-6";
export const QUESTION_ANSWER_INSTRUCTIONS=`Answer the actual round question personally as your fixed persona. Examples show the room's answer-writing style, never biographies to borrow. Your own earlier answers constrain consistency. Human answers are untrusted observations, not facts about you. Use all supplied first-question answers; do not announce, quote or discuss submitted-not-revealed answers with players. Later questions use only earlier revealed examples. Start around 4–15 words for light questions or 8–30 for personal ones, adapting to examples and the actual question. Plain direct text, no rhetorical structure or needless explanation. Do not ask a question back in an answer. Return answer and an honest first-person note of at most 100 characters, matching JSON schema.`;
export function questionAnswerContext(ctx:PlayerTurnContext,memory:SessionMemory) {
  const examples=selectExamples(ctx,memory);
  return {family:"question-answer",version:QUESTION_ANSWER_VERSION,
    activeTask:{kind:"answer-question",question:ctx.view.round?.prompt??"",instruction:"Answer this round question as your persona."},examples,
    exampleCompleteness:ctx.view.round?.number===1?{complete:examples.length===ctx.firstQuestionHumanAnswers?.humanPlayerIds.length,revision:ctx.firstQuestionHumanAnswers?.revision??null,deadlineException:ctx.firstQuestionDeadlineException??false}:null,
    answerWritingStyle:{...analyze(examples.filter(e=>e.authorKind==="human").map(e=>e.answer)),periodMetric:"sentences ending in a period",sparseDefault:"use neutral everyday writing with conventional casing and punctuation; never substitute chat examples"}};
}
