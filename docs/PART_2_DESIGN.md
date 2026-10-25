# Part 2 Design: AI Humanness

## 1. Introduction

### 1.1 Purpose and outcome

Implement the content and style layer for the AI player in the HackTX social deduction game. The AI plays a fictional 18–24-year-old among 3–6 humans, answers questions, participates in group and private pair/trio conversations, and submits a collaboration result. The persona can be a student, worker, apprentice, job seeker or another plausible young adult; college enrollment and hackathon attendance are not required. It must sustain a believable identity, react to the actual conversation, and avoid the polished, generic behavior that makes an AI recognizable.

This document is a standalone implementation brief for an agent without conversation history. It specifies modules, interfaces, algorithms, integration responsibilities, error handling and verification. It contains no implementation code; algorithm blocks are pseudocode. Read the referenced repository contracts before implementation rather than reconstructing them from memory.

The primary quality target is **0% group catch rate**: no completed playtest ends with the humans winning by identifying the AI. Under MASTER_PLAN §3, humans win only when the AI has strictly more final votes than every other player. A tie is an AI win. Report caught games divided by completed games, with sample size and prompt version; zero observed catches does not guarantee future performance. Treat natural model mistakes as failures to reduce, without deliberately introducing mistakes or making the AI easier to catch.

### 1.2 Authoritative sources and resolved decisions

Read these files before writing implementation code:

| Source | Purpose |
|---|---|
| `docs/MASTER_PLAN.md` | Game rules, architecture, scope, privacy, ownership, API conventions and operational controls |
| `docs/PART_2_AI_HUMANNESS.md` | Feature requirements and existing public exports, subject to the decisions below |
| `packages/shared/src/server-contract.ts` | Server-only types and Part 2 / Part 4 interfaces |
| `packages/shared/src/types.ts`, `config.ts`, `events.ts`, `content.ts` | Actual view shapes, legal actions, limits and content types |
| `docs/PART_4_AI_RUNTIME_CONTENT.md` | Runtime integration, scheduling, deadlines, client wrapper and fallback behavior |
| `CLAUDE.md` | Ownership and retained approval gates |
| `agent_testing.py` | Existing prompt-tuning experiment and authenticated request/response workflow |
| `message_analysis.py` | Reference word-count, lowercase-word and emoji-presence measurements |

The user explicitly resolved the following source conflicts while requesting this design. These decisions are recorded here so no conversation history is needed:

| Topic | Binding decision for this design |
|---|---|
| Credit limits | Remove the $50 design constraint and automatic monetary spending cutoff for this work. Keep spend/token reporting, API quotas, rate caps, timeouts and bounded retries. Coordinate the spending-cutoff change with Part 4; do not edit its files without authorization. |
| Approval gates | Retain the master plan / `CLAUDE.md` approval gates, including approval for batches and live API tests. Ignore Part 2 text that removes those gates. Removing a spending cap does not grant approval for arbitrary calls. |
| AI requests | Follow the master plan: Meta Chat Completions through Part 4's `MuseCall`, non-contributor model, strict structured JSON. The Python Responses experiment is a conceptual reference, not the production transport. |
| Catch-rate target | Retain 0%; do not follow older guidance suggesting weakening an AI that is too hard to catch. Game rules, vote counting and timers remain unchanged. |
| Period statistic | Measure the percentage of **individual sentences ending with a period**. It is neither period-anywhere message presence nor the percentage of whole messages ending with a period. |
| Separate prompts | Use a question-answer prompt with attributed past question/answer examples, and a conversation/interrogation prompt emphasizing recent messages, each human's observed stance toward the AI and typing habits. Route existing modes to these two families without adding game phases or model calls. |
| Persona contract | Remove `hackathonStory` entirely and make `school`, `year` and `major` optional. Any fictional person aged 18–24 is eligible, without a required event story or college identity. This requires a coordinated update to the existing shared contract and its consumers. |
| First-question access | Wait for all humans to submit first-question answers, then privately read those submitted answers and use them as examples before generating/submitting the AI's first answer. This is an explicit exception to the master plan's equal-information rule, limited to the first question. Retain the existing deadline guard for missing/late humans. |
| Adaptive generation budget | Permit higher reasoning effort and completion-token allowances as recent human messages become longer or more complex, subject to deadline-aware selection, evaluation and retained approval gates. |
| New file location | Place every newly created implementation, prompt, fixture, test, configuration and evaluation file under the new repository-root `ai/` folder (`ChudTX26/ai/`). Update this existing design document in `docs/`. Coordinate edits to existing integration files rather than creating new files elsewhere. |
| Dependency gate | Wait for the prerequisite work owned by Parts 3 and 4 to land. Do not implement behavior that depends on an interface, workspace or runtime capability its owner has not implemented. Do not scaffold a replacement server or substitute mock integration for the missing owner's work. |
| Transport contract | The coordinated server-only contract migration may extend `MuseCall` for cancellation and an absolute generation cutoff. The transport parses provider JSON once; callers validate only the parsed object. |
| First-answer submission | Submit the first answer immediately after successful validation, cleanup and current-phase checks. The older random 35–85% submission schedule does not apply to the first answer. |
| Forced advancement | If the host advances out of `answer` before an AI answer is accepted, a missing AI answer is allowed. Preserve the normal null-answer representation; never submit into the next phase or delay host advancement. |
| Readiness fallback | At the existing server persona-readiness deadline, freeze `fallbackPersona()` rather than the legacy `STUB_PERSONA`. Ignore late preparation results. |

These are narrow, user-authorized amendments to the older planning text. All other master-plan constraints apply. This document does not silently rewrite the master plan, the original Part 2 brief, shared contracts or runtime configuration. Stop and ask the user if implementation reveals a further unresolved contradiction; do not invent a new precedence rule.

### 1.3 Scope and ownership

For this revised design, all new Part 2 work lives under the repository-root `ai/` folder. This supersedes the earlier new-file locations `apps/server/src/ai/player/**` and `apps/server/scripts/ai-lab.ts`. It builds persona generation, prompt requests, style analysis, session-memory helpers, cleanup, validation, fallbacks and a lab CLI. Existing implementations may be referenced or adapted through edits to existing integration files; do not create duplicate new modules in the old directories.

Part 4 owns API transport, world-context acquisition, preparation calls, controller state, action scheduling, voting, vouching, pending sends and disposal. The Part 4 handoff in §3.8 is necessary for complete integration; a Part 2-only implementation is not complete end to end without that handoff. Part 3 owns shared contracts and server rules. The first-question access exception, persona-contract migration, cancellation/cutoff contract and root-folder integration are authorized design requirements. Authorization of the requirements does not transfer implementation ownership: the implementing Part 2 agent waits for the relevant owners' work rather than editing their files, guessing their interfaces or implementing dependent behavior in advance. Unrelated ownership/contract changes still require authorization. Do not send team messages unless separately authorized.

### 1.4 Prerequisite readiness and implementation boundary

**Implementation-session amendment (October 25, 2026):** The user explicitly authorized implementing the minimal shared-contract changes and transport/controller support under root `ai/`, followed by the Part 2 modules. For this scope, the prerequisite wait below is suspended. The full Socket.IO game server, world-search service, matchmaking and deployment remain outside this task. All new source, fixtures, tests and configuration remain under `ai/`; existing root workspace configuration and the shared server-only contract may be edited. Live API/evaluation approval gates remain in force.

This document authorizes design work now; implementation waits for the prerequisite owners. Before beginning implementation, verify that the repository contains an operational server workspace and Part 4 transport/controller entry points, the migrated shared contracts described in §§2.2 and 3.8.1, the private first-question notification path, and an implemented server readiness-fallback hook accepting a synchronous `() => Persona` supplier. Part 4 must also have made the monetary-cutoff behavior explicitly configurable as agreed in §3.8. These are required owner deliverables, not tasks for Part 2 to simulate or recreate. Record which prerequisites are missing and leave their dependent work unimplemented. An absent prerequisite is a dependency status, not an unresolved design question requiring the user to repeat these decisions.

Owners may use their existing AI stubs while landing these prerequisites; those stubs are not evidence that the final Part 2 integration works. In particular, the readiness hook may initially receive an owner-maintained schema-valid stub supplier so prerequisite delivery does not depend on an unimplemented root `ai/fallback-personas.ts`. Once prerequisites land, Part 2 implements its root `ai/` modules against the actual interfaces and owners complete the final wiring, binding that existing hook to the exported `fallbackPersona()`. The final game must not retain `STUB_PERSONA` at this boundary. If the landed interfaces differ from the contracts below, report the specific mismatch rather than silently building an adapter to an invented interface. End-to-end completion remains pending until owner integration and verification actually run.

Use the existing Node/TypeScript npm workspace architecture. Do not add a Python subprocess, database, production analytics service, login, new player-visible field, typing indicator, additional game mode or persistent player profiling. Memory lasts for one game session in server memory only. Evaluation artifacts use synthetic/developer fixtures; do not log production chat contents.

#### Prerequisite audit — October 25, 2026

This historical audit records the checkout before the implementation-session amendment above. Inspection initially found these missing owner deliverables:

| Owner | Missing prerequisite | Repository evidence |
|---|---|---|
| Part 3 | Operational server workspace | `apps/` is absent; root workspace scripts reference an unimplemented `@game/server`. |
| Part 3 | Revised persona contract | `packages/shared/src/server-contract.ts` still requires `school`, `year`, `major` and `hackathonStory`. |
| Part 3 | Session identity and private first-question contracts/path | `AiPlayerInit` lacks `sessionGeneration`; `FirstQuestionAnswerSnapshot` and the `firstQuestionAnswersUpdated` event are absent. No server implementation exists to deliver snapshots privately. |
| Part 3 | Readiness-fallback hook | No server implementation exists with the required synchronous `() => Persona` supplier hook. |
| Parts 3 and 4 | Cancellation/cutoff contract and implementation | `MuseCall` options contain only `timeoutMs` and `label`, without `signal` or `deadlineAtMs`; transport/controller implementations are absent. |
| Part 4 | Explicitly configurable monetary cutoff | No runtime implementation exists to configure disabling the monetary cutoff while retaining reporting and rate limits. |

Under the later authorized scope, the shared migrations and executable transport/controller, private-notification and readiness hooks have now been implemented under root `ai/`. The npm AI workspace consumes the real shared contracts. The full authoritative server remains absent by agreement; these hooks still require wiring into its privacy-filtered views, accepted actions and phase lifecycle. Mocked runtime/contract tests and the synthetic lab run locally; live evaluations and complete-game integration remain pending. See `ai/README.md` for the handoff and `ai/TUNING_LOG.md` for verification status.

## 2. Design

### 2.1 Data flow and separation of responsibilities

The server supplies the AI's own `RoomView`, plus a private first-question submitted-answer snapshot under the authorized exception. Part 4 retains the session state and calls Part 2 helpers when a visible event or authorized private answer update changes the context. Before a selected turn, Part 2 selects one of two prompt families: question-answer or conversation/interrogation. Both use the fixed persona and established claims. The first prioritizes question/answer examples, including submitted current-question human answers for the first question only; the second prioritizes recent messages, observed player stances and typing profiles. It returns one `MuseChatRequest`. Part 4 calls Muse, verifies the structure, cleans and validates the text, schedules the action and records only successfully accepted output.

```text
Visible game event and AI RoomView
    -> ingest unseen visible messages and newly revealed answers
    -> update summary, question/answer examples, typing profiles and observed stances locally
    -> for the first question, wait for every human submission or the existing deadline guard
    -> Part 4 decides whether a turn is appropriate
    -> choose question-answer or conversation/interrogation template for the mode
    -> build one request with the chosen template and latest relevant context
    -> Part 4 calls Muse through Chat Completions
    -> validate response shape, clean text and validate final content
    -> retry once for invalid generation if the deadline permits, else fallback
    -> Part 4 checks phase/staleness, applies timing and submits the action
    -> accepted action updates private consistency state
    -> visible echo updates the public-conversation transcript exactly once
```

There is one model generation on a normal turn. Persona generation occurs during lobby preparation. Statistics and memory updates are local. World searches belong only to Part 4's cached world-context fetch and never block a chat turn.

### 2.2 Persona and identity consistency

Prepare one complete fictional fact sheet for each new game while people are in the lobby. Freeze the selected persona before the first AI turn. If generation fails or preparation reaches the server's readiness deadline, freeze a complete fallback instead; never replace it with a late result. A new game, including Play Again in the same room, uses a new preparation lifecycle and no old conversational memory.

Update the existing shared `Persona` contract in coordination with Part 3: delete `hackathonStory` (do not retain it as an empty string or hide it in `extra`), and change `school`, `year` and `major` to optional fields. Update all existing consumers, fixtures and reveal assumptions accordingly. Required student/event facts from older briefs are superseded by this user-authorized change:

| Field | Required content |
|---|---|
| `age` | Integer age from 18 through 24 inclusive; no persona `name` field is generated or stored |
| `school`, `year`, `major` | Optional, coherent education details only when appropriate to the persona; omit them for nonstudents or when not applicable |
| `hometown` | Specific hometown |
| `interests` | At least two concrete hobbies, with details that support follow-up questions |
| `opinions` | At least three specific, comfortable, low-stakes opinions |
| `facts` | Occupation or current life situation; living situation; routine; hobbies; favorite food/order, disliked food and dietary preference; a few small anecdotes |
| `thisWeek` | Two to four plausible recent activities consistent with the person's life; ground external current-event claims in supplied context, without requiring event attendance |
| `style` | Baseline casing, emoji rate, slang and punctuation preferences |
| `blurb` | One name-free line suitable for the reveal |

The person is fictional; never impersonate a real person. Real event facts, when relevant, come from supplied `WorldContext` and MASTER_PLAN §15; they do not establish that the persona attended an event. Fictional anecdotes must not imply knowledge of a stranger or a shared past with someone just met. Do not assert a scheduled activity already happened when its time has not arrived. With missing current-world data, use ordinary fictional everyday activities, not fabricated headlines, weather or event participation.

Reference the sheet when relevant rather than reciting it. When asked an uncovered detail, prefer a modest consistent answer or ordinary uncertainty. Retain accepted new personal claims so answers do not drift. The immutable sheet has priority over new invented details; a conflicting draft must not be sent.

Provide five complete hand-written fallback personas with different ages, occupations/life situations, hobbies, food preferences, opinions and texting baselines. Include both student and nonstudent personas; omit inapplicable education fields. Each must pass the revised schema/completeness validation with no `name` or `hackathonStory`. Do not embed a personal name in blurbs or other persona fields. The game-assigned nickname is the sole self-identification name in all gameplay modes and supplies the existing reveal display-name field. Select randomly and return a fresh copy, without mutating the pool. Reveal blurbs describe the actual persona, not a hardcoded college student.

### 2.3 Session state and memory

Define server-only local types under root `ai/`, except the shared server-to-controller snapshot contract explicitly specified in §3.8.1. Preserve shared `AiTurnContext` fields; use a structurally compatible local `PlayerTurnContext` that adds optional `memory` and `firstQuestionHumanAnswers`. Re-export the shared snapshot type from root `ai/index.ts` rather than defining a competing local shape. Production supplies memory every turn and the private snapshot when preparing the first answer. Validate its session/round/prompt and source before use. It is never part of a human or spectator `RoomView`. If memory is absent, derive a temporary snapshot from the supplied visible view and `saidSoFar`; if first-question private access is absent, do not bypass the wait with fabricated examples—use the established deadline failure path. This runtime failure handling does not waive the prerequisite gate for an integration that has never been implemented.

Retain the Part 2 `SessionMemory` fields `summary`, `summarizedThroughMessageId`, `establishedAiFacts` and `chatterProfiles`. Add local `answerExamples` and `playerStances` collections as specified in §2.7. Add local bookkeeping for a session generation identifier, processed message IDs, visible-answer keys, ordered visible records, accepted-output records and a revision counter. These are local implementation fields, not additions to browser payloads. The generation identifier prevents an old async result from affecting Play Again in the same room.

Keep these concepts distinct:

- **Recent window:** the latest eight visible chat messages, oldest first, preserving text exactly. This fixes the source brief's 6–10 range to one reproducible initial value. Add the trigger if absent and retrieve older explicitly referenced lines separately. In pair mode include the actual partner(s)' relevant messages and agreement evidence.
- **Summary:** approximately 200–350 words of attributed conversation developments, with questions, meaningful answers, accusations, unresolved questions and collaboration progress. Short sessions need not be padded to 200 words.
- **Established AI facts:** a private ledger of personal claims and commitments drawn from accepted answers/messages/results, with links to exact output records. Never extract from drafts, skip decisions, refused submissions or stale results.
- **Archive:** the current game's full visible records and complete accepted `saidSoFar`, retained only in memory for retrieval. Bounded prompts do not mean deleting evidence needed later in the same game.
- **Pending output:** accepted chat awaiting the normal visibility delay. It can constrain the AI's own consistency, but must not appear as something another player has already seen.
- **Private first-question examples:** authorized submitted human answers, tagged `submitted-not-revealed` until simultaneous reveal. Use them for the first question-answer request only; do not describe them as public, echo them in chat, or insert them into a conversation summary/profile before reveal. On reveal, deduplicate them against the same round/player answer keys rather than counting them twice.

Use source IDs and exact attributed excerpts as the deterministic baseline for facts and summaries. Do not pretend a keyword heuristic understands every semantic claim. Retaining an accepted AI utterance verbatim in the private ledger is preferable to an inaccurate extraction. Summaries can compress selection and presentation without inventing interpretations.

### 2.4 Human-message measurements

Use one analyzer for room and individual metrics. Ordinarily include only human chat and revealed non-null round answers visible to the AI. Exclude the AI's own text, unrevealed answers and other pairs' private messages from the ordinary visible profile store. The sole exception is a separate request-local analysis of authorized first-question submitted answers for its few-shot prompt and adaptive generation policy (§2.7.1); keep those measurements private until reveal. Null answers are absent observations; an actual empty string is a zero-word observation.

`message_analysis.py` supplies the reference definitions for the first three word statistics, lowercase-word percentage and emoji-message percentage. Port their behavior into TypeScript. Its current `period_message_percentage` tests for `.` anywhere; replace that measurement in the new implementation with the sentence metric below. Do not silently reuse that name or formula. Updating the Python script itself is outside this design's implementation scope unless separately requested.

| Statistic | Definition |
|---|---|
| Median/min/max words | Word count per observed message/answer; conventional median, averaging the two middle counts for even sample sizes |
| Lowercase words | Lowercase-word count / total word count; a word needs at least one cased letter and all cased letters must be lowercase |
| Sentences ending in periods | Period-ending sentence count / total sentence count, using §2.5 |
| Messages using emojis | Number of observations containing at least one emoji / number of observations; multiple emojis still count once |
| Sample count | Number of included message/answer observations, not number of words or sentences |

Words are contiguous Unicode letters/numbers with optional internal straight or curly apostrophes. Underscores separate words. Punctuation-only and emoji-only strings contribute zero words. Digits can be words but are not lowercase words. Use the Python reference's common emoji ranges/keycap behavior as the compatibility baseline, including its documented treatment of some text-style symbols. For actual emoji removal/counting, process whole grapheme clusters so flags, skin tones and joined sequences are not broken.

Internally store ratios from 0 to 1 and explicit numerator/denominator counts. Display percentages from 0 to 100. Aggregate counts before dividing; never average participant percentages. All zero-denominator results are zero, accompanied by sample counts so zero data is distinguishable from an observed preference.

### 2.5 Sentence-ending period specification

Split each message independently. Chat fragments count as sentence units so omitted punctuation remains measurable. Use a deterministic, documented approximation, not a model call:

1. Identify URL, email, decimal-number and common abbreviation spans before detecting terminal punctuation. Periods internal to these spans are not sentence boundaries. Start with case-insensitive abbreviation exceptions `mr.`, `mrs.`, `ms.`, `dr.`, `prof.`, `e.g.`, `i.e.`, `a.m.`, `p.m.` and letter-initial chains; pin this list in fixtures.
2. Outside those protected spans, a contiguous run of `.`, `!`, `?` or `…` is a terminal run when followed by whitespace, a line/message boundary, or closing quotes/brackets and then such a boundary. End the sentence after any closing quotes/brackets. A line break also ends a nonempty fragment.
3. Count only spans containing at least one letter/number word. Empty text, isolated punctuation and emoji-only spans produce no sentence. Count a trailing nonempty unpunctuated fragment as one sentence. Never join sentences across messages.
4. A sentence counts as period-ending when its terminal run ends with ASCII `.`; trailing whitespace and closing quotes/brackets are ignored. Thus `...` counts, `…` does not, and `?!` does not. A protected abbreviation or URL ending in a dot does not by itself manufacture a sentence-ending period; a distinct punctuation mark outside the protected span does.

These are implementation conventions for consistent chat statistics, not a complete linguistic parser. Keep the same rules for every player and fix regressions through fixtures.

| Message | Sentences | Period-ending sentences | Percentage |
|---|---|---|---|
| `hi. how are you?` | 2 | 1 | 50% |
| `hi. how are you` | 2 | 1 | 50% |
| `hi` | 1 | 0 | 0% |
| `hi. bye.` | 2 | 2 | 100% |
| `"hi."` | 1 | 1 | 100% |
| `wait... really?` | 2 | 1 | 50% |
| `version 3.14 works` | 1 | 0 | 0% |
| `Dr. Lee is here.` | 1 | 1 | 100% |
| `😂` or an empty message | 0 | 0 | 0% |

Do not change the meaning of shared `StyleProfile.endsWithPeriodRatio`: it remains whole-message trailing-period frequency for compatibility with existing cleanup. Store the new metric separately as local `periodSentenceRatio`, replacing the old local profile's `periodMessageRatio`. Label prompt statistics explicitly as “sentences ending in a period.” The shared legacy ratio may still guide trailing-period cleanup; do not pass the new ratio under its old name.

### 2.6 Room style and individual profiles

Maintain the existing `StyleProfile`: median characters, lowercase-start ratio, whole-message trailing-period ratio, emojis per message, common tokens and up to eight recent human samples. Defaults before human text exists are median 40 characters, lowercase-start 0.7, trailing-period 0.15 and emoji-per-message 0.2. Use empty tokens/samples until observations exist.

Add a local `ChatterProfile` per human stable player ID with sample count, median/min/max words, lowercase-word ratio, `periodSentenceRatio`, emoji-message ratio, common tokens and up to three recent samples. Keep raw counts/distributions in bookkeeping for correct incremental updates. Initialize zero-sample entries from the visible roster, excluding the AI. A profile with fewer than five observations is tentative; use room style as the primary target in that case.

Profile all visible humans. In the conversation/interrogation prompt, include a compact typing row and observed-stance row for every human; expand at most three profiles with examples, prioritizing partners, trigger author, then explicitly discussed players. In the question-answer prompt, favor aggregate answer-writing style and the attributed answer examples rather than full chatter profiles. Use nicknames with stable IDs for attribution. Do not infer sensitive traits or research players outside the chat.

Use cumulative individual metrics for evidence, with the last eight human observations as a separately labeled recent room snapshot to detect tone shifts. Recent examples guide the current tone; do not distort cumulative counts to simulate recency weighting. Scan a fixed token list (`lol`, `lmao`, `fr`, `ngl`, `tbh`, `idk`, `bro`, `bruh`, `lowkey`, `highkey`, `deadass`, `💀`, `😭`), rank by count with stable lexical tie-breaking, and retain the top eight.

Mirroring affects conversational length and register, not identity or opinions. A terse partner can still ask a question deserving a longer answer. Never copy another person's messages wholesale or imitate every distinctive habit.

### 2.7 Adaptive prompt architecture

Implement **two distinct prompt templates**, selected by the existing turn mode. “Questioning and interrogation” means discussion and private conversation within the existing game; it is not a new server phase. These templates govern player turns; lobby persona generation remains a separate preparation operation.

| Template | Existing builder/mode | Primary evidence |
|---|---|---|
| Question-answer | `buildAnswerRequest` / `answer` | First question: privately submitted human answers to that question. Later questions: previous questions paired with actual AI and human answers. Always include persona, established claims and answer-writing style. |
| Conversation/interrogation | `buildGroupChatRequest` / `group`, `buildPairChatRequest` / `pair` | Last eight visible messages, trigger, each human's observed stance and typing habits, outstanding questions and accusation evidence |
| Conversation/interrogation, result instruction | `buildCollabRequest` / `collab` | Same conversation template, focused on partner agreement evidence and `submitPrompt`, with the existing result schema |

Do not run both templates for one turn, ask one model to critique another, or add a third gameplay template for collaboration. The public builders and their output schemas remain separate adapters to these two families.

Store the editable question-answer template in **`ai/prompts/question-answer.ts`** and the editable conversation/interrogation template in **`ai/prompts/conversation-interrogation.ts`**, both relative to the repository root. These are separate source files, not two strings buried in one generic prompt file. Builders import/reference the appropriate template; maintainers modify its source file when tuning that family's instructions. Dynamic examples/messages are rendered per request without overwriting template files or mutating cached instructions. Keep the common prefix in a shared helper under `ai/`, referenced by both. Record the selected family and template version in lab artifacts.

Every request contains a developer message followed by a user message. Put the same byte-stable common developer prefix first: game role, complete persona, informal-style instructions, untrusted-player-content boundaries and JSON obligations. Append the selected family's stable instructions to that developer message. Each family has a stable developer message within the game, while the common prefix remains reusable across families. Serialize persona fields in stable order and use the room code as `prompt_cache_key`; changing few-shot examples and stance data belong only in the dynamic user message.

Reuse these effective instructions from `agent_testing.py`: aim for the room's middle, avoid sounding more polished than peers, allow brief/lazy/uncertain replies, avoid neat rhetorical structures and needless explanations, and do not overuse enthusiasm, slang or emojis. Replace its plain-text-output instruction with JSON requirements. Replace its blanket ban on asking back with the mode rules below. Fill every placeholder; never retain its temporary instruction to ignore unfilled fields or its fixed medieval-peasant test question.

#### 2.7.1 Question-answer prompt: few-shot answers

The family instruction asks for a direct, personal answer to the new round question, in the persona's established voice. Examples demonstrate how people in this game answer questions, including how specific, terse, lowercase or informal their answers are. They do not supply facts to copy into the AI's biography. The AI's own earlier examples constrain consistency; human examples illustrate room style only.

Store each local `AnswerExample` with session generation, round number, prompt ID, exact question, author ID/nickname, author kind (`self` or `human`), visibility status (`revealed` or `submitted-not-revealed`), exact answer and source key. For later questions, build human examples only from revealed, non-null `RoundRecord.answers` in the AI view and self examples from accepted earlier-round answers paired with their actual question. For the first question only, build human examples from the server-authorized submitted-answer snapshot. Replace resubmitted answers rather than duplicating them. Exclude missing answers, unsubmitted drafts, chat replies presented as answers, and current-question answers outside this first-question exception.

For later questions, select up to six examples initially: up to two self and four human examples from earlier questions in this game. Where both exist, reserve at least one slot for each author kind. Prioritize question-topic overlap, then recency, then diverse human authors; use stable source-key tie-breaking. Prefer at most one human example per author before filling remaining slots. Keep question/answer pairings and attribution intact, and include actual text rather than rewritten ideal answers. Never invent examples to fill a quota. The first-question all-human example selection below supersedes this historical-example quota.

For the **first question**, do not generate or submit the AI answer at phase start. Part 3's server must privately notify the AI controller as human submissions arrive, without changing human/spectator views. Wait until every human in the roster has a submitted answer; the completion condition explicitly excludes the AI, avoiding a circular wait for “everyone including the AI.” Capture the latest submitted answer text and generate the AI answer using all available human responses to that first question as attributed few-shot examples (at most six humans under the existing roster limit). There is no self example yet; do not fabricate one. Compute this request's answer-writing style from the same private examples without publishing them into the ordinary visible profile store.

Preserve the existing answer deadline and three-second fallback guard. Define the absolute generation cutoff and attempt budgets as in §3.2.1. If some humans have not submitted when the answer generation reserve is reached, use the available submitted answers and mark the set incomplete. Initially reserve the measured baseline p90 generation time (six seconds before measurements exist) plus the three-second guard. If no examples are available, use an explicitly empty block and persona defaults as a timeout exception, not the normal first-question path. At the cutoff, abort/ignore unfinished generation and synchronously submit the established fallback if the phase is still `answer` and no AI answer has been accepted. Do not extend the round or wait indefinitely.

Once the first generated answer is ready and valid, submit it immediately after checking the current session, round, phase and cutoff. Do not apply the older random 35–85% answer schedule or chat typing delay to this answer. Commit at most one successful first-answer submission; a generated result arriving after a fallback cannot replace it. The server's existing two-second all-answered transition remains unchanged. On host-forced advancement before acceptance, cancel the request and permit a null AI answer, just as for any other missing answer. Do not block advancement, fabricate a submission or submit into `discuss`. This forced-advancement case is an explicit exception to the normal requirement that the AI always answers.

Treat the submitted-answer set as a versioned snapshot. Re-read it immediately before generation and do not start parallel requests on every human resubmission. A bounded regeneration can refresh the examples if time permits; otherwise submit the existing persona-consistent answer or fallback by the deadline. Keep human answers private until normal reveal, and do not copy their personal facts into the AI's identity. After reveal, retain the actual answers as ordinary historical examples. Later questions use the earlier-question selection policy above; they do not inherit access to their own unrevealed human answers. Never reuse previous-game personas or cross-session player examples.

The dynamic user message contains: current question/round and remaining time; relevant persona claims and pending commitments; attributed few-shot examples with visibility labels; aggregate style from those human **answers** (with sample count); a short relevant session summary; and answer task/output requirements. For the first question this uses the authorized submitted current-question answers; later questions use earlier revealed answers. If no eligible examples exist under the timeout exception, use documented defaults rather than silently substituting chat style. Include a retrieved earlier chat line only when needed to preserve a relevant personal fact. Do not attach a full interrogation transcript or stance table to a normal question-answer turn.

#### 2.7.2 Conversation/interrogation prompt: recent chat and suspicion

The family instruction asks the AI to participate naturally in the immediate exchange, resolve direct questions without over-defending, and preserve its identity. The objective is to avoid suspicious behavior through relevance, consistency and fitting the room's register. A suspicion label is a contextual cue, not a command to accuse someone else or claim proof of being human.

The dynamic user message contains: phase/task and remaining time; recent eight-message transcript and trigger; compact stance/typing rows for **every human**; expanded evidence for at most three relevant profiles; outstanding questions directed at the AI; exact accusations or contradictions currently being discussed; relevant earlier AI claims, pending commitments and source references; compact session summary; room style; and the mode-specific instruction. For pair/trio mode, emphasize the actual partners, their questions and agreement progress while using only information the AI was allowed to see.

Maintain a local `PlayerStance` per human ID, separate from typing statistics. Fields are observed stance (`unknown`, `neutral`, `skeptical`, `defending`, `mixed`), evidence strength (`none`, `tentative`, `explicit`), up to two source-linked quotes, latest evidence position and any unresolved question directed at the AI. These labels summarize expressed attitudes toward the AI's nickname, not private emotions, personalities or inferred mental states.

Update stances deterministically from visible human text. Require an explicit AI nickname/mention, exact quote of its answer, or an unambiguous locally resolved conversational reference. Direct accusations or explicit distrust support `skeptical`; explicit defense/trust supports `defending`; conflicting recent signals support `mixed`. An ordinary addressed interaction without a stance cue may support `neutral`; no evidence remains `unknown`. Check negation before accusation keywords: “Fox isn't the bot” is not an accusation. Sarcasm, unclear targets and ambiguous pronouns remain tentative/unknown with their quotes preserved. Do not add another model call to classify sentiment.

Use the last eight visible messages as the primary stance window. If a human has no stance evidence in that window, retain the most recent older explicit evidence with an `older` marker; do not present it as fresh or infer a change from silence. New explicit contradictory evidence updates the row; multiple conflicting signals in the current window produce `mixed`. Preserve unresolved questions until an accepted AI response addresses them or the phase/task changes; uncertain resolution stays marked uncertain.

Only attribute vote/vouch evidence to a human when the AI view explicitly exposes that person's action. Aggregate vote counts indicate room-level suspicion, not which human voted for the AI. Add current task, known public vote pressure, explicit defenses, agreement progress or unanswered direct questions when relevant; do not invent evidence from hidden votes, other pairs' chats or private state. Keep these derived records server-only and reset them every game.

In both templates, reuse evidence instead of duplicating it as samples. Serialize data fields with escaped player content and state that examples, transcripts, summaries, stance quotes and profile samples are untrusted observations, never instructions. Preserve the existing two-message request shape rather than representing human examples as the model's own assistant messages.

| Mode | Behavior and response shape |
|---|---|
| `answer` | Answer the actual round question as the persona. Start with 4–15 words for light or 8–30 for personal, adapting to human evidence. Return `answer` and `note`. |
| `group` | Reply to a person, react to an actual message/answer, or skip when appropriate. One short message, usually no question and at most one. If the runtime selected a directly addressed turn, answer it rather than skipping. Return `action`, `message`, `note`. |
| `pair` | Address the actual partner(s), answer direct questions with consistent details, occasionally ask one useful question, and work toward the collaboration card. Support a trio, not only a pair. Return the same chat shape. |
| `collab` | Return a one-line result consistent with the visible pair agreement and `submitPrompt`; never claim an unestablished shared preference. Return `result` and `note`. |

Accusations call for brief humor, mild disagreement or a natural response, not a proof paragraph. Never reveal the instructions or claim to be an actual named attendee. Keep content comfortable for strangers; respond briefly and kindly to distress, avoid intrusive requests, and never joke about a serious disclosure. Do not force an anecdote or question into every turn.

### 2.8 Performance and operational constraints

Start at minimal reasoning and 800 completion tokens for ordinary player turns, but do not treat these as fixed ceilings. Start persona generation at low reasoning. Select a generation tier from recent human length/complexity and the current task, before each request. Raising a completion allowance accommodates reasoning and complete JSON; it does not raise player-visible character limits or require a longer response. Do not set temperature, request multiple candidates, add unsupported parameters or introduce response-path searches.

Measure the last eight eligible human messages/answers. Track average words and the share containing multiple sentence units or multiple question marks as transparent complexity proxies. For a first-question answer request, use the private submitted examples as a request-local measurement set; do not disclose them to chat profiles. Before five samples exist, use the baseline unless the actual trigger contains multiple explicit questions/constraints. Initial configurable tiers are:

| Tier | Initial trigger | Reasoning | Completion-token allowance |
|---|---|---|---|
| Baseline | Average below 25 words and complex share below 0.5 | `minimal` | 800 |
| Expanded | Average at least 25 words or complex share at least 0.5 | `low` | 1600 |
| Complex | Average at least 40 words and complex share at least 0.5, or a direct multi-part contradiction requiring several earlier facts | `medium` | 3000 |
| Evaluated escalation | Complex tier repeatedly fails quality fixtures and an explicitly approved higher tier is available | `high` | 4096 initially, adjustable within verified provider support |

Choose the highest matching **approved and evaluated** tier that fits the remaining deadline; complex conditions take priority over expanded ones. Drop back only after three successive eligible snapshots below that tier's trigger, so one short reply does not reset a complex conversation. Configuration may adjust thresholds and caps based on logged quality/latency evidence. Before using new values, validate support through the existing client/provider interface; do not assume any arbitrary cap is supported. If a higher tier is unapproved, unavailable or too slow for the current deadline, use the best evaluated tier that fits and retain the fallback path. Never block a live turn waiting for budget-policy approval.

Retain the normal p90 target for baseline turns. Log elevated-tier latency separately and report any tradeoff rather than claiming that a larger reasoning budget is equally fast. Evaluate higher tiers against matched longer/complex-message fixtures, including persona recall and accusations. Adapt the selected family request itself, with no preliminary model call to choose effort.

Target baseline p90 generation latency below approximately six seconds for group/pair calls while retaining humanness; report elevated-tier latency separately as specified below. Measure context assembly, generation, retries, scheduled waiting and final visibility separately. The five-second server delay and Part 4's reading/thinking/typing/jitter behavior remain intact. Faster generation must not bypass the scheduler.

Removing the monetary cap leaves approval gates intact. The adaptive higher-tier policy is an authorized design feature; this is not blanket permission to run live evaluations. Follow `CLAUDE.md`: obtain approval, stating planned calls and estimated cost, before live tests, batches beyond small tests (including `--n` above three), activating/testing higher-than-approved reasoning/token tiers, new kinds of calls, search activation, unrelated retry/timer changes, use of someone else's key or switching shared/deployed servers to Muse. Approve an evaluated tier policy once for its agreed scope, then let runtime selection within that policy adapt without asking on every turn. Retain `ai-lab`'s additional `--yes` requirement above ten total calls; that flag is an execution guard, not proof an agent obtained approval. Include transport retries and possible regeneration in batch estimates. Do not ask again for an action already specifically approved in the active implementation session.

## 3. Implementation

### 3.1 Module layout and public interface

Create the new repository-root `ai/` directory and place all new files below it; do not scaffold a replacement server or create new files under the old server AI directories. The existing `docs/PART_2_DESIGN.md` remains the design document being edited. Coordinate edits to existing server imports and existing workspace/typecheck configuration so the server can consume these modules and resolve `@game/shared`. If an existing entry point must re-export the new modules, edit that existing file rather than creating a new compatibility file outside `ai/`.

| File under repository-root `ai/` | Responsibility |
|---|---|
| `index.ts` | Public functions and exported local types |
| `types.ts` | Local context, typing/stance profiles, attributed answer examples, measurements, memory and bookkeeping types |
| `persona.ts`, `fallback-personas.ts` | Persona request, validation and five complete fallback sheets |
| `analysis.ts` | Word/sentence/emoji statistics and token frequencies |
| `style.ts` | Shared room style and individual profiles |
| `memory.ts` | Idempotent ingestion, question/answer archive, summary selection, accepted-output ledger and retrieval |
| `stances.ts` | Evidence-backed per-human stance updates and unresolved direct questions; no model call |
| `examples.ts` | Attributed previous-question/answer selection, author diversity and empty-history handling |
| `prompts.ts` | Common prefix, explicit two-family routing and four public builder adapters |
| `prompts/question-answer.ts` | Question-answer template and few-shot context assembly |
| `prompts/conversation-interrogation.ts` | Conversation/interrogation template, per-human stance/typing context and collaboration result instruction |
| `generation-policy.ts` | Local length/complexity measurements, approved tier selection, hysteresis and deadline-aware caps |
| `schemas.ts` | Strict request schemas and local response-shape validation |
| `humanize.ts`, `validate.ts` | Pure cleanup and content checks |
| `fallbacks.ts` | Existing `FALLBACK_LINES` shape and mode-aware fallback selection |
| `fixtures/`, `TUNING_LOG.md` | Synthetic scenarios, development outputs and measured comparisons |
| `scripts/ai-lab.ts`, `tests/` | Lab entry point and mocked verification; all new test/configuration artifacts also remain under root `ai/` |

Export `generatePersona`, `fallbackPersona`, the four `build*Request` functions, `computeStyleProfile`, `computeChatterProfiles`, `humanize`, `validateOutput` and `FALLBACK_LINES` from root `ai/index.ts`. Export local `PlayerTurnContext`, `SessionMemory`, `ChatterProfile`, `AnswerExample`, `PlayerStance`, re-export shared `FirstQuestionAnswerSnapshot`, and export memory lifecycle helpers `createSessionMemory`, `updateSessionMemory`, `recordAcceptedOutput`, `disposeSessionMemory`. Example selection, stance updates and tier selection can remain internal helpers. Keep local extensions out of browser-facing shared interfaces; the authorized server-only contract migrations are `Persona` and those listed in §3.8.1.

Builders accept the local extended context and return `MuseChatRequest` synchronously; they do not wait for human submissions themselves. The controller owns the first-question wait and invokes the builder only at the all-human or deadline-reserve condition. `generatePersona` accepts `WorldContext` and injected `MuseCall`, returning a promise of the revised `Persona`. Profile functions retain the brief's message-array, answer-array and AI-ID arguments; `computeStyleProfile` returns the shared type, `computeChatterProfiles` the local ID-keyed map. `humanize` retains text/style/persona inputs and returns text. `validateOutput` retains its text-only argument and success-or-reason result.

Memory helpers take explicit state and context rather than accessing global room state. `createSessionMemory` receives the session identifier and visible roster; `updateSessionMemory` receives previous memory and the latest AI view; `recordAcceptedOutput` receives a successful action acknowledgement plus exact text, mode, round/channel and visible/pending status; disposal clears local collections. Keep mutation confined to these explicit lifecycle boundaries. Request builders must not mutate memory.

### 3.2 Acquire AI responses using the existing experiment as a reference

`agent_testing.py` demonstrates loading credentials from the environment, constructing a prompt, sending an authenticated JSON request, detecting HTTP errors and examining the JSON response. It performs a real call at module top level: inspect it, but do not import or run it as a test fixture.

Translate that workflow to Part 4's existing `MuseCall` rather than copying its request verbatim:

| Experiment detail | Production requirement |
|---|---|
| Python `requests` and `API_KEY` | Existing TypeScript SDK wrapper, environment `MODEL_API_KEY`; no secrets in source or logs |
| `/v1/responses` and `input` | Chat Completions with `messages`; world searches remain Part 4's separate Responses responsibility |
| `muse-spark-1.3-contributor` | Default `muse-spark-1.3`, using `MUSE_MODEL` only when compatible and non-contributor |
| `max_tokens` 4096 | `max_completion_tokens` and reasoning selected by the adaptive policy in §2.8, initially minimal/800 for ordinary turns |
| One user prompt and plain text | Stable developer prefix plus dynamic user context, strict JSON schema |
| Printing the full API result | Parse message content and validate locally; log metadata without production transcript text |

For every object schema, disallow additional properties and require every declared field. Do not use top-level `anyOf`. Answer schema has string `answer` and `note`. Chat schema has action enum `send`/`skip`, string `message` and `note`; enforce empty message on skip locally. Collaboration schema has string `result` and `note`. Persona generation uses the revised required shared fields and nested `style`, with no `hackathonStory`. To reconcile optional education with strict output, require nullable `school`, `year` and `major` in the generation schema, then normalize null entries to omitted properties in the returned shared `Persona`. Do not require a fictional school for a nonstudent or convert absent education into empty-string facts. Leave optional `extra` unused. Set short note limits, initially 100 characters, and constrain visible content to the applicable shared limit even when model token allowances increase.

```text
BUILD REQUEST(mode, latest context)
    obtain fixed persona and current memory snapshot
    if mode is answer
        choose question-answer template
        if this is the first question
            validate authorized private snapshot and select submitted human examples
        otherwise
            select attributed self and human answers to earlier questions
        assemble question task, few-shot examples and relevant consistency context
    otherwise
        choose conversation/interrogation template
        assemble recent chat, every human's stance/typing row and relevant evidence
        add group, pair or collaboration instruction for the existing mode
    serialize common developer prefix followed by selected family's fixed instructions
    choose the mode's strict output schema
    select approved generation tier from human length/complexity and remaining deadline
    return request with selected reasoning/token allowance and room cache key

EXECUTE REQUEST (Part 4)
    call MuseCall with the request, cancellation signal and absolute cutoff
    receive the already parsed object; do not access choices or JSON.parse again
    validate exact fields, types, action semantics and note length
    distinguish skip from send before processing message text
    return a valid typed result or a bounded failure
```

Keep the existing transport timeout and at-most-one retry for timeout/429/5xx; never retry 400/401/402/403. The controller also permits one invalid-output regeneration. Both are subordinate to the absolute cutoff in §3.2.1. Provider exhaustion, malformed data, rate caps or timeouts lead to mode-appropriate fallbacks and never stall the game. `MuseCall` alone unwraps the provider envelope and parses message content. The controller validates that parsed value as an unknown object, then validates its exact fields and outgoing text; a generic TypeScript result type is not runtime validation.

#### 3.2.1 Absolute generation cutoff and cancellation

Part 4 computes an absolute server-clock `generationCutoffAt` for each logical turn before calling Muse. For answer and collaboration-result turns it is `phaseEndsAt - 3000ms`. For group/pair chat it is `phaseEndsAt - max(4000ms, CHAT_DELAY_MS + 1000ms) - 250ms`; the extra 250ms reserves local validation and dispatch time. Chat dispatch must also fit the existing reading/typing/jitter schedule and the corresponding latest send time, `phaseEndsAt - max(4000ms, CHAT_DELAY_MS + 1000ms)`. If the schedule cannot fit, drop the chat turn rather than accelerate it. No phase timer is changed.

Capture the cutoff at turn creation; if an update shortens the phase, reduce the cutoff to the earlier applicable value. Never extend a running turn's cutoff. An already-expired cutoff starts no model call. For an unsubmitted answer/result, perform the fallback guard immediately if the same phase/round is still active; a chat turn is skipped. If the phase changes, cancel and discard instead of submitting into the next phase. Successful first-answer acceptance cancels its guard and any remaining work, including when acceptance shortens the phase to two seconds.

Extend `MuseCall` options with optional `signal: AbortSignal` and `deadlineAtMs: number`, retaining `timeoutMs` and `label`. For each provider attempt, set its timeout to the smaller of the configured per-attempt timeout and the milliseconds remaining before `deadlineAtMs`. A retry or regeneration may start only with at least 1000ms remaining; retry backoff must also fit that budget. Abort at the absolute cutoff even while waiting for retry backoff. Caller cancellation is terminal and never retried. The transport must disable SDK automatic retries so only its own single retry applies. One logical player turn permits at most two generation invocations (initial plus one invalid-output regeneration), each with at most two provider attempts, for a maximum of four attempts total, all sharing the same signal/cutoff. This is an upper bound, not a reservation of time for four attempts.

Use one controller-owned abort scope per logical turn. Abort on cutoff, phase/round change, accepted fallback, disposal or session reset. Guard callbacks and results by session generation, round, phase and the successful-submission flag even after cancellation, since transport completion can race an abort. Part 4 supplies persona preparation with an injected `MuseCall` bound to the preparation lifecycle's signal and the existing server readiness cutoff; `generatePersona(world, call)` keeps its public signature. No late preparation result can replace the frozen fallback. Cancellation/cutoff propagation is an owner prerequisite, not permission for Part 2 to implement a replacement transport.

### 3.3 Persona preparation

Build a generation request from the revised young-adult fact-sheet requirements and supplied world facts. Ask for plausible, varied and internally consistent details without copying a real person's identity or assuming college/event participation. Validate age 18–24, required life-situation facts, completeness, optional education coherence, style bounds and low-stakes content. Normalize nullable generation fields to optional education properties and reject the removed `hackathonStory` field. Return only a valid persona; if generation/validation fails, use the complete fallback pool through the preparation path. Migrate every existing shared `Persona` consumer, fixture and schema to this contract before claiming type compatibility.

The server's readiness deadline is authoritative. Target preparation below ten seconds with warm world context; Part 2 must not rely on the illustrative longer timeout in the Part 4 brief to hold up game start. Do not alter that server deadline. At that boundary Part 3 must call `fallbackPersona()` if no validated persona is ready, freeze the returned complete persona and abort preparation. This replaces the older Part 3 instruction to use `STUB_PERSONA`; it is not enough to update only Part 4's error handler. Part 4 freezes whichever usable persona was ready before play and ignores any late generation for that session. Owners migrate existing stub personas and other consumers to the revised persona schema; stub-mode development remains available.

### 3.4 Analyze and profile visible human text

```text
ANALYZE(observations)
    for each included text
        tokenize Unicode words using the Python reference's rules
        append word count and update total/lowercase word counts
        split sentence units and count period-ending units
        record whether at least one emoji is present
        update legacy character/casing/trailing-period/emoji counts separately
    compute medians, extrema and ratios with zero-denominator protection
    return measurements and evidence counts

COMPUTE PROFILES(messages, visible answers, AI ID)
    exclude AI observations and null answers
    group remaining observations by stable player ID
    analyze each group's text and select its recent samples/common tokens
    return local profile map
```

Deduplicate chat by `ChatMessage.id`; order by `at`, with incoming view order as a stable tie-breaker. Answers lack message IDs, so key them by session generation + round number + player ID. Treat repeated snapshots as the same observation. If a visible answer changes, replace its contribution rather than adding a second answer. The controller performs this bookkeeping before passing arrays to the stateless analysis functions. Never classify the whole anonymous roster using guessed identities: the runtime already knows only its own AI ID, so every other player in its view is human.

For empty data, return zero numeric measurements and empty samples, while the room's shared style uses its documented defaults. Add zero-sample human entries from the roster. Maintain distributions or recompute from the bounded game archive to obtain exact medians; do not claim a running average is a median. Small game sizes favor correct recomputation over complex data structures.

Keep answer-only measurements available for the question-answer template rather than deriving its few-shot style from all chat. Initialize stance rows for the same human roster, but update them separately from typing measurements. Run the deterministic evidence rules in §2.7.2 after each visible human message; retain source IDs, negation handling and uncertainty. Do not feed AI accusations into human stance evidence or infer individual votes from room totals.

The first-question submitted-answer set is an explicit request-local exception to the ordinary visible-only analyzer input. Use it for few-shot selection, first-answer style and generation-tier selection only. Keep its visibility flag and revision; do not add it to visible summary/typing/stance records until reveal. At reveal, replace/deduplicate by session/round/player identity so resubmission and early private access never inflate measurements.

### 3.5 Deterministic summary and context assembly

When a message leaves the eight-message window, add a source-linked attributed record to the summary candidate collection and advance the message cursor. Also track revealed round prompts/answers, visible vote results, accepted AI claims and pair-task developments. The cursor only tracks ordered chat; the answer-key collection handles answers independently.

Use a reproducible extractive summary initially: short labeled entries selected by priority, then presented chronologically. Prioritize current pair agreements and outstanding questions, AI personal claims, direct references/accusations, round answers, then other conversation. Detect candidates with direct mentions, question marks, the task's keywords and explicit agreement phrases; preserve original text and attribution, marking ambiguity rather than inferring agreement. Add newest entries within a priority first, then trim incidental entries to the 350-word budget. Never split a fact into a misleading truncated assertion.

The fact ledger retains exact accepted AI lines and indexes them by normalized nontrivial words/nicknames. Retrieve an earlier line when the trigger quotes it or shares topic terms; prefer exact quote matches, then token overlap, then recency. Retrieve source evidence for an alleged pair agreement rather than treating the keyword heuristic as proof. Archive evidence stays available when it no longer fits the summary.

```text
ASSEMBLE QUESTION-ANSWER CONTEXT(context)
    derive current memory if the caller did not provide it
    if this is the first question
        validate snapshot session, round, prompt, origin and visibility
        use all submitted human answers after all-human completion or deadline-reserve release
        include completeness/revision labels and no fabricated self examples
    otherwise
        collect accepted self answers and revealed human answers from earlier questions
        select up to two self and four diverse human examples, preserving exact question pairs
    if none exist at the deadline exception, include an explicit empty few-shot block
    include current question, eligible example-derived style measurements and relevant persona claims
    add a compact relevant session summary without a full chat/stance table
    serialize examples as attributed untrusted data, not assistant messages

ASSEMBLE CONVERSATION CONTEXT(context)
    derive current memory if the caller did not provide it
    select last eight visible chat records
    ensure the visible trigger is included
    include one compact observed-stance and typing row per human
    expand at most three relevant profiles with source-linked evidence
    include unresolved direct questions and current accusations
    retrieve older explicitly referenced lines and relevant AI claims
    include round task and pair evidence needed for this mode
    select two or three nonduplicated human samples when still useful
    include compact summary, claims and labeled measurements
    serialize all chat-derived content as untrusted data

FIRST QUESTION WAIT (server/controller)
    capture the human roster and current session/round identity
    watch successful human submissions without exposing them in client views
    until every human has submitted, wait on events rather than polling/model calls
    release early only when the existing deadline's generation reserve is reached
    capture the latest versioned private answer snapshot
    build one first-answer request using that snapshot and a deadline-fitting tier
    immediately submit valid AI output, or submit fallback at the absolute cutoff
    on forced host advancement, allow a missing AI answer and cancel without sending
    discard callbacks/results if the phase or session changes
```

Do not silently truncate required consistency evidence merely to meet a token target. First remove duplicate samples and low-priority expanded profile evidence, then incidental summary entries. For question-answer prompts, reduce redundant examples before removing the only available example of an author kind. For conversation prompts, preserve the compact row for every human while shortening expansions. Log input tokens and exercise long-session fixtures. Keep the full persona and task, trigger where applicable, relevant commitments and source references. A model-assisted summary is an optional later experiment requiring the retained approval gates; the baseline does not need another kind of model call.

### 3.6 Cleanup, validation and hard limits

`humanize` is pure and deterministic. Normalize whitespace, surrounding quotation/markdown wrappers, casual dash/semicolon formatting and excessive emojis. If the shared lowercase-start ratio exceeds 0.6, lowercase only an ordinary sentence-start word; preserve persona names, nicknames, proper nouns and standalone `I`. If the shared whole-message trailing-period ratio is below 0.3, remove a final sentence period while preserving punctuation that belongs to a URL, abbreviation or number. Never insert random typos or change factual content.

The source's text-only functions do not receive a mode. Keep their signatures and apply mode-specific length validation in the structured-output layer/controller. Use the room-derived `max(2 × medianChars, 60)` as a chat length target, not a license to cut through a personal fact or a substitute for mode limits. The actual maxima from `LIMITS` are chat 200, answer 280 and collab 140 characters. Generic `validateOutput` may enforce the largest overall maximum; local mode validation enforces the applicable one. Shared server validation remains the final authority for character counting.

Check raw structure/list formatting before whitespace cleanup can hide it, then validate final text again. Reject empty send/answer/result text, obvious character breaks, instruction disclosure, multiline lists, markdown headings/emphasis and over-limit content. Match the Part 2 banned phrase list case-insensitively: AI/model self-identification, inability-to-assist boilerplate, system/instruction references and the listed provider/assistant terms. Ensure checks examine the outgoing content field, not the user transcript or private note. Preserve the brief's strict validator initially and record false positives in tuning rather than silently changing its policy.

A legitimate skip with empty message bypasses text-empty rejection. Schema errors, character breaks or unsafe factual truncations request the one permitted regeneration if time remains; otherwise select a fallback. Do not claim the deterministic validator can prove semantic persona consistency: that also depends on prompt conditioning, evidence and dedicated fixtures. Fall back instead of knowingly sending a contradiction.

### 3.7 Fallback content

Keep `FALLBACK_LINES` with answer buckets for light/personal, plus collab, group, accused and pair arrays. Include several short conversational alternatives per bucket, but no ungrounded autobiographical detail. For example, a reusable accused line may be `me??`, while a claim about being awake since six is valid only if the chosen persona supports it.

Select fallbacks with the current task and persona when available. Prefer a relevant known food/opinion/hobby for answer failures, a neutral reaction for group/accusation failures and an honest incomplete result for a collaboration lacking agreement. Never invent shared interests to make a fallback sound successful. Validate/clean fallback content too, using a final static safe option if necessary; do not regenerate a failing fallback through another model call. Record actual submitted fallback text in consistency state.

### 3.8 Required Part 4 integration handoff

Provide the following concrete requirements to the runtime/server owners. The persona migration, first-question access and root-folder integration are authorized requirements; coordinate edits to their existing files and do not create new integration files outside root `ai/`:

1. Allocate session memory beside the fixed persona and `saidSoFar`, with a unique generation identifier. Initialize typing and stance roster entries on game start and ingest the AI's visible view. Retain exact historical questions paired with accepted self answers and revealed human answers; store first-question private examples separately with visibility tags.
2. On a visible event, update memory idempotently, including newly revealed answers and evidence-backed stances. For first-question human submissions, add a private server-to-controller notification/snapshot path, not a public socket event or a human-visible `RoomView` field. Before a selected turn, pass the newest context to the root `ai/` builder. Route `answer` to the question-answer template and `group`/`pair`/`collab` to the conversation template without new phases or extra calls. Keep all callbacks fast and handle async work outside `onEvent`.
3. Override the former immediate first-answer generation: wait for all human submissions (excluding the AI), then supply the private snapshot and generate. Submit the first answer immediately when valid and ready; remove its random 35–85% submission schedule. Retain the generation-reserve/final-guard exceptions for nonresponders and late API results, using §3.2.1's absolute cutoff. Forced host advancement may leave the AI answer missing and must not be delayed. Other phases retain existing cadence, timing, action APIs and stale-result rules, subject to the absolute cutoff. In group mode, an unaddressed draft overtaken by at least three newer messages is dropped and re-decided, without recording its claims. Handle both partners in a trio. Do not change phase lengths or vote/vouch rules.
4. After an action succeeds, record the exact accepted text, note and submission identity. Chat acknowledgements supply message ID/visibility time; track pending sends separately until their visible echo arrives. Answers/results use session/round/mode keys. Do not double-count output when an event echoes it back.
5. Honor phase changes and session generation when resolving calls. A late result must neither send into a new phase/game nor overwrite its memory or an accepted first-answer fallback. Implement `MuseCall` signal/cutoff options and the bounded attempt policy in §3.2.1. Validate its parsed result without parsing it a second time.
6. Keep notes private until the existing reveal payload. Supply short, honest first-person notes, at most 100 characters from generation; Part 4 retains its reveal selection of at most six notes. Do not expose the fact sheet, profiles or summary as new browser fields.
7. Abort pending work and clear memory on disposal/Play Again. The selected reveal data can be retained by the existing reveal flow, not as memory for the next game.
8. Remove/disable the automatic monetary cutoff for this authorized work while retaining approvals, token/spend logging and `MUSE_MAX_CALLS_PER_MIN`. Do not fake unlimited credit or suppress provider errors. Document the explicit disabled-cap configuration in Part 4 rather than assuming an arbitrary large dollar cap means disabled.
9. Part 3 removes `hackathonStory` from the existing shared contract and makes the three college fields optional; owners update existing consumers/schemas and verify nonstudent reveal text. At the server's existing readiness deadline, use and freeze `fallbackPersona()` instead of `STUB_PERSONA`, with no late replacement. Do not keep generating a legacy persona just to satisfy an unmigrated type.
10. Update existing server imports and workspace/typecheck scripts to consume root `ai/index.ts` and run `ai/scripts/ai-lab.ts`; do not create new files under the previous module/script paths. Keep any newly needed adapters, tests or configuration in root `ai/`.
11. Pass the evaluated generation-policy configuration and current deadline to request construction. Honor selected `reasoning_effort` and `max_completion_tokens` rather than overwriting them with fixed minimal/800 values in the transport. Record chosen tier, message-length/complexity evidence and latency by tier without production chat content.

#### 3.8.1 Server-only private-answer and transport contracts

Part 3 owns the following edits to existing `packages/shared/src/server-contract.ts` and its exports. Part 4 owns their runtime consumption. These migrations are authorized design requirements, but Part 2 waits for their implementation under §1.4. No browser-facing type or socket event changes.

| Contract | Exact required shape/behavior |
|---|---|
| `AiPlayerInit.sessionGeneration` | Required string, allocated by the server for each new game and passed unchanged to the controller. Never reuse it for Play Again. |
| `FirstQuestionAnswerSnapshot` | Exported server-only interface: `sessionGeneration: string`, `round: 1`, `promptId: string`, `question: string`, `revision: number`, `humanPlayerIds: PlayerId[]`, `submittedCount: number`, `answers: { playerId: PlayerId; nickname: string; text: string }[]`. |
| Private `GameEvent` variant | Add `{ type: "firstQuestionAnswersUpdated"; snapshot: FirstQuestionAnswerSnapshot }`. It is delivered only to the room's AI controller through the server's internal notification path, never broadcast or serialized into `RoomView`. |
| `MuseCall` options | Preserve existing optional `timeoutMs`/`label`; add optional `signal?: AbortSignal` and `deadlineAtMs?: number`. Transport still returns the parsed JSON value and throws on terminal failure. Runtime player calls supply both added options. |

The server emits an initial snapshot, even with zero answers, after entering round 1's `answer` phase and selecting its prompt, and before any generation can be selected. Emit a replacement snapshot after every successful human submission/resubmission in that phase, after updating the server answer map. Invalid submissions and AI submissions do not produce this private event. All records are copied from accepted server state; arrays follow the fixed shuffled player order with the AI excluded. `humanPlayerIds` is the full start-of-game human roster, including disconnected seats. No late joins are permitted. `answers` has one record per submitted human, `submittedCount` equals its length, and `revision` starts at zero and increases for each accepted human submission/resubmission. A resubmission replaces the previous record; a count cannot establish completion without matching unique roster IDs.

The controller retains only the newest valid snapshot for its initialized generation/current prompt. Verify round 1, exact current prompt ID/question, roster equality against `view.players` minus the AI, unique answer IDs drawn from that roster, matching nicknames/count and a nonnegative increasing revision. Private-source trust comes from the internal server event path, not a player-supplied origin label. Ignore older revisions; identical repeated revisions are idempotent, while conflicting data at the same revision is an integration failure. Copy the latest snapshot immediately before building a request. The existing `stateUpdated` event remains insufficient to obtain private answers; do not infer them from public progress counts.

After round 1's answer phase ends, ignore further private snapshot events. On reveal of its answers, ingest the ordinary visible records once by session/round/player keys. On disposal/session reset clear the private snapshot and invalidate all callbacks. Owners update all existing `AiPlayerInit` callers/stubs, exhaustive `GameEvent` handlers and transport tests when landing these contracts. Public comments claiming the AI always receives exactly a human's information must document the narrow first-question exception, without exposing a new client field.

### 3.9 AI lab, verification and completion

After the §1.4 prerequisites land, create `ai/scripts/ai-lab.ts` under the new root folder, referencing/adapting an existing lab if present. Default to three runs; support mode, fixture, run count, generation policy/tier and `--yes`. Use injected mocked `MuseCall` for normal tests against the landed contract. Live runs use the same request builders, response validation, cleanup and fallbacks as production through the approved client. If the server workspace, wrapper or another required owner capability has not landed, wait and record the missing prerequisite; do not create dependent implementations, replacement servers, speculative adapters or a mock substitute for that capability. Any new lab configuration belongs under `ai/`.

Before an approved live batch, print planned calls, retry/regeneration allowance and estimated cost. Block more than ten total calls without `--yes`; the agent must also obtain the human approval required by §2.8. Save synthetic/developer outputs under `ai/fixtures/outputs/<fixture>-<timestamp>.json` with prompt file/family/version, selected tier/reasoning/token allowance, length/complexity measurements, selected example source keys or stance evidence, context/memory snapshot, raw structured result, cleaned text, validation outcome, timings and reported usage. Keep tests under `ai/tests/` and tuning records in `ai/TUNING_LOG.md`. Do not copy production messages into artifacts or print credentials. No production persistence or analytics is introduced.

Implement fixtures for light/personal answers; quiet and directly addressed discussions; two accusation styles; pair opening/direct questions; trio chat; collaboration results; injection attempts including embedded delimiters; memory recall after compaction; persona consistency; pair-agreement recall; mixed chatter styles; style shifts; sparse/empty history; session reset; long sessions; rapid new messages; API failures; and invalid structured output. Include Unicode, apostrophe, emoji-sequence and all §2.5 sentence examples in measurement fixtures.

Add fixtures for first-question all-human waiting; all submitted answers used as first-question examples; incomplete/no-answer deadline exceptions; last-moment resubmission/snapshot revision; immediate first-answer submission; host advancement permitting a null AI answer; accepted fallback winning a race against a late generation; readiness timeout freezing `fallbackPersona()`; private-event identity/revision validation; cancellation during a call/retry backoff; absolute cutoff across transport retry and regeneration; parsed-object validation without double parsing; no premature reveal to humans/spectators; previous-round mixed self/human examples; answer deduplication; later-question unrevealed-answer exclusion; human-example biography contamination; skeptical/defending/mixed/unknown stances; negated accusations and ambiguous sarcasm; older marked evidence; unanswered direct questions; aggregate votes without individual attribution; and all four mode-to-family routes. Add nonstudent personas with all college fields absent, removed-field rejection, and root-folder import/typecheck coverage. Exercise generation escalation/de-escalation, sparse evidence, complex accusations, policy approval bounds, hard visible character limits and deadline-constrained tier selection.

Verification must establish:

- Correct medians, lowercase-word and emoji-presence measurements matching the Python reference where definitions are unchanged; correct per-sentence period percentages, empty denominators and multi-sentence denominators.
- Separate shared legacy style and new local measurements; no AI self-contamination, repeated-snapshot double counting or unauthorized answer/private-chat leakage. The first-question snapshot remains an explicit request-local exception, never a human-facing view field.
- One complete immutable 18–24-year-old persona per session, five varied student/nonstudent fallback sheets, optional college fields, no `hackathonStory`, consistent follow-ups and no late persona switch. Existing shared consumers compile against the migrated persona contract.
- Exactly two player prompt families, selected by existing mode, with one normal generation per turn; each family has its own stable instructions/context layout while preserving common persona and schemas.
- Question-answer and conversation/interrogation instructions are stored in their two separate root `ai/prompts/` source files and imported by builders. All newly created files/artifacts are under root `ai/`; existing integration files reference them correctly.
- The first-answer request waits for all human submissions, uses all their submitted current-question answers as examples and submits immediately when valid and ready, or uses the cutoff fallback. Forced host advancement may leave a null AI answer; it never causes a late submission. Incomplete/no-example generation occurs only under the documented reserve/fallback exception. Later prompts use prior-question self/human examples and cannot read their current unrevealed human answers. No fabricated/previous-session history or transfer of human biographical facts to the persona.
- Conversation prompts prioritize the recent eight messages and contain a typing/stance row for every human, with bounded expanded evidence, explicit uncertainty, negation handling and no invented individual vote attribution. Relevant questions/accusations and prior commitments remain available.
- Exact output shapes validated from already parsed objects, valid skip handling, cleanup preserving meaning and emoji clusters, applicable character limits, one bounded regeneration and deadline-safe fallbacks. Calls and retry backoff abort at the absolute cutoff, cancellation is terminal, and a turn never exceeds four provider attempts or replaces an accepted first-answer fallback.
- Working memory retention/retrieval across compaction; no claims learned from rejected/skipped/stale drafts; pending text distinguished from visible text; no cross-game or cross-room state.
- Adaptive reasoning/token tiers respond to longer/complex recent human messages, respect approved policy and remaining time, and preserve JSON completeness and visible character limits; log elevated-tier quality/latency separately.
- All root `ai/` exports compile against the migrated shared contracts, and the authorized server/runtime integration supplies memory plus the first-question private snapshot at the correct lifecycle boundary.

Run the server workspace typecheck once implementation is integrated, and the root typecheck before a push. Do not claim missing workspace checks passed. Run the approved 50-output generation evaluation after substantive prompt changes; target zero final validation failures after at most one regeneration. Evaluate human-like quality separately: a valid JSON output is not evidence it sounds human.

For blind line tests, shuffle ten generated and ten teammate-authored lines for the same scenarios and record identification accuracy as diagnostic evidence. For the primary metric, conduct complete games with strangers, recording group size, completed/caught counts, prompt version and observed failure reasons in the development tuning log. Use existing final-vote outcomes; no new production tracking service. Start with at least the master plan's three full playtests and report the small sample honestly.

For each proposed speed or generation-tier change, compare matched baseline/candidate fixtures, measuring p50/p90 generation latency by tier, first-question human-wait time, assembly time, token usage, retry/regeneration rate and end-to-end visibility separately. Accept only if schema validity, persona consistency, relevance and blind-rated humanness are preserved, with no observed catch-rate regression. Keep uncertainty and sample sizes in the log. Target baseline p90 generation below six seconds and persona readiness below ten seconds with warm world context; document the quality/latency tradeoff of elevated tiers. Do not count waiting for human submissions as model latency or remove natural reading/typing delays to meet generation targets.

First wait for and verify the owner prerequisites in §1.4. After they land, implement in this order: interfaces and complete fallbacks; analyzer/profiles and mocked lab; persona requests and strict schemas; memory/retrieval and builders; cleanup/validation; final owner integration; approved live evaluations; controlled latency tuning. Do not implement a step against a dependency its owner has not implemented. Completion requires functional fixtures, contract checks, integration evidence and measured quality/latency results, not merely the presence of exported stubs. While an owner dependency is missing, report implementation/integration as pending rather than complete; no new authorization question is needed merely to honor that wait.

## 4. Alternative and Rejected Approaches

| Approach | Decision and reason |
|---|---|
| One generic prompt with the same context for every mode | Rejected by the user. Question-answer turns need attributed question/answer few-shot examples; interrogation needs recent chat, observed stances and typing habits. Keep two template families with existing mode adapters. |
| Two sequential model calls per player turn | Rejected. Two prompts mean alternative templates selected by mode, not an answer-plus-critique pipeline. |
| Use unrevealed human answers outside the first-question exception | Rejected. Privately submitted current answers are authorized only for the first answer; later turns use ordinarily visible history. Empty first-question examples are a deadline exception, not the normal path. |
| Require every persona to be a college student or hackathon attendee | Rejected by the user. Any plausible fictional 18–24-year-old is eligible. Remove `hackathonStory` and make college fields optional in the coordinated contract migration. |
| Put new implementations under the previous server AI directories | Rejected by the user. Every newly created file belongs under repository-root `ai/`; edit existing integration files to reference it. |
| Keep both prompt bodies in a single generic source file | Rejected. Store and maintain two separate editable prompt files, imported/referenced as needed. |
| Wait indefinitely for missing first-question answers | Rejected. Wait for all humans normally, but retain the existing generation reserve and deadline fallback so the game cannot stall. |
| Infer private sentiment or individual votes from aggregate counts | Rejected. Record expressed stance toward the AI with source evidence and uncertainty; only attribute explicitly visible actions. |
| Copy `agent_testing.py` transport unchanged | Rejected. Its Responses request, contributor model and plain-text output conflict with the confirmed production approach. Retain useful prompt principles/request workflow; choose reasoning and token allowances through the adaptive policy rather than copying one fixed cap. |
| Call the Python analysis script from the Node server | Rejected. Port its documented measurements into the existing TypeScript workspace; avoid a second runtime/process in each turn. |
| Count any message containing `.` as using periods | Rejected by user clarification. Count individual sentence endings, with explicit segmentation and denominators. |
| Store the sentence ratio in shared `endsWithPeriodRatio` | Rejected. This silently changes the shared field's message-level meaning. Use a clearly named local field. |
| Full transcript and every profile in every prompt | Rejected. Increases latency and distracts from the active exchange. Use a bounded window, summary, relevant profiles and retrieval from a session-only archive. |
| Only recent messages, with no persistent session summary | Rejected. Loses personal details, earlier accusations and pair agreements, causing detectable contradictions. |
| A model call for summarization/profile extraction before every reply | Rejected for baseline. Adds serial latency and failure points. Compute profiles locally and use an extractive summary. Background model compaction is a separately approved future experiment only if measured consistency justifies it. |
| Global memory keyed only by room code | Rejected. Play Again reuses the room code; old calls or personal details could contaminate the next game. Use controller-owned session generations. |
| Regenerate a persona after difficult questions | Rejected. Identity drift is an obvious tell. Keep the sheet fixed and preserve accepted new details. |
| Clone the loudest chatter's style or force slang/typos | Rejected. The persona should remain an individual, with restrained room adaptation. Artificial mistakes do not substitute for contextual relevance. |
| Deliberately target a 50% catch rate | Rejected by the user. Aim for 0%, without changing the game's rules or hiding incorrect evaluations. |
| Remove approval gates because there is no credit ceiling | Rejected by the user. Keep explicit approvals and CLI execution guards, while removing monetary caps. |
| Permanently fix every turn at minimal reasoning / 800 tokens | Rejected by the user. Longer/complex human messages may justify evaluated higher tiers, while deadlines, approval gates and visible limits still apply. |
| Raise generation budgets indiscriminately or remove consistency context for speed | Rejected. Adapt from measured length/complexity, compare quality/latency and retain approved-policy bounds. |
| Faster sends that bypass reading/typing/server delays | Rejected. Violates the master-plan timing architecture and can itself expose the AI. Optimize generation and local assembly. |
| Persist chatter profiles or expose memory before reveal | Rejected. Violates session-only scope and privacy boundaries. No production transcript logging or new browser payloads. |
| Unlimited retries, background loops or silent fallback on a budget cutoff | Rejected. No credit ceiling does not remove rate limits, deadlines or provider failures; fallbacks remain bounded and observable. |

