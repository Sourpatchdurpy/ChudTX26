# Part 4: AI runtime, agents, content and submission

**You own:**
- `apps/server/src/ai/**` **except** `apps/server/src/ai/player/**` (that's Part 2). That covers `ai/index.ts`, `ai/muse.ts`, `ai/controller/**`, `ai/world/**` and `ai/matchmaker/**`.
- `content/question-bank.json`
- `docs/submission/**`

**Read first:** `docs/MASTER_PLAN.md` (§3 rules, §8 AI facts), then `packages/shared/src/server-contract.ts` and `types.ts`.

> **Paste this into your coding agent:**
> You are implementing Part 4 (the AI runtime) of a HackTX party game where one player is secretly an AI. Read `docs/MASTER_PLAN.md`, `docs/PART_4_AI_RUNTIME_CONTENT.md` and all of `packages/shared/src/`. Only edit files under `apps/server/src/ai/` (excluding `ai/player/`, which Part 2 owns), `content/` and `docs/submission/`. Implement `createAiPlayer` (`CreateAiPlayer`), `prepareAiPersona` (`PrepareAiPersona`) and `runMatchmaker` (`RunMatchmaker`) exactly as typed in `server-contract.ts`, and export them from `apps/server/src/ai/index.ts`. Call Meta's Muse through the `openai` npm SDK with `baseURL: "https://api.meta.ai/v1"`. Use Part 2's exported request builders and humanizers from `../player/index.js` for everything the AI says. Your code decides when the AI acts and how long it "takes to type". The AI must never stall the game: every Muse call has a timeout and a fallback. Ask me clarifying questions instead of guessing. Each of us has only $50 of Muse credit, so build the spending guardrails in §1 first, and follow "Ask before you act" in `CLAUDE.md`. Ask before any run that makes more than ~10 real Muse calls, before raising reasoning effort, and before changing retry or timer behavior.

---

## 1. `ai/muse.ts`: Muse client (P0, push by C0 at 9:30pm. Part 2 needs it.)
```ts
import OpenAI from "openai";
import type { MuseCall, MuseChatRequest } from "@game/shared";

const client = new OpenAI({ baseURL: "https://api.meta.ai/v1", apiKey: process.env.MODEL_API_KEY });
const MODEL = process.env.MUSE_MODEL ?? "muse-spark-1.3";
const DEFAULT_TIMEOUT = Number(process.env.MUSE_TIMEOUT_MS ?? 12000);

export const museCall: MuseCall = async <T>(req: MuseChatRequest, opts = {}) => {
  // 1. AbortController timeout (opts.timeoutMs ?? DEFAULT_TIMEOUT)
  // 2. client.chat.completions.create({ model: MODEL, ...req }, { signal })
  // 3. retry ONCE on timeout / 429 / 5xx (not on 400: log the error body, it's a bad request)
  // 4. JSON.parse(choices[0].message.content) → return as T
  // 5. log: `[muse] ${opts.label} ${ms}ms in=${usage.prompt_tokens} out=${usage.completion_tokens}` (+ reasoning tokens if present)
};
```
**Also export `museResponses(body)`**, a thin wrapper over `client.responses.create({ model: MODEL, ...body })` with the same timeout and logging. It's for web search.

**SDK notes:**
- The `openai` package is v7.x. Check its README for the current signatures of `chat.completions.create` and `responses.create`.
- The Meta request shapes are in MASTER_PLAN §8:
  - `reasoning_effort`
  - `response_format` json_schema on Chat Completions
  - `tools: [{ type: "web_search" }]` and `text.format` on Responses
- **Unsupported (400):** `stop`, `n > 1`, `logprobs`.

**Track call counts and token usage per room** in memory, so we can quote real cost numbers.

**Spending guardrails (P0, build these before anything else calls Muse; see MASTER_PLAN §8.1):**
- **Estimated cost per call** = `prompt_tokens × $1.25/1M + completion_tokens × $4.25/1M`, minus the cached-token discount if reported. Keep a running total per process, and log it on every call.
- **Spending cap:** if the running total passes `MUSE_BUDGET_USD` (default 5), every later `museCall` throws `BudgetExceededError` immediately, without calling the API. Log a loud warning once. The controller then uses fallback lines.
- **Rate cap:** sliding-window limit of `MUSE_MAX_CALLS_PER_MIN` (default 60). Calls over it throw `RateCapError` (same handling).
- **Retries:** at most one, only on timeout, 429 or 5xx. **Never** on 400/401/402/403.
- **Web search:** `museResponses` with `web_search` counts searches too ($2.50/1,000). Only `getWorldContext` may use it.
- **Tests:** `museCall` can be swapped for a mock (`setMuseCallForTests(fn)`), so tests never hit the API.

**Your key powers the deployed game** (team decision). At C2:
- SSH into the VM and add `MODEL_API_KEY` to `/opt/game/.env` yourself. Don't send it to anyone.
- Ask the human what `MUSE_BUDGET_USD` should be on the server. (Suggestion: ~$20 on the server, ~$5 per laptop in dev, which leaves headroom from your $50 for your own development.)

## 2. `ai/world/`: world context and persona prep (P0 → C2)
**`hacktx-facts.ts`:** export `HACKTX_FACTS: string[]`, the facts from MASTER_PLAN §15 (food, schedule, venues, theme).

**`getWorldContext(): Promise<WorldContext>`:**
- **Cache** for `WORLD_CONTEXT_TTL_MS` (60 min), shared across rooms. Deduplicate concurrent calls with one in-flight promise.
- **Warm the cache when the module loads** (`void getWorldContext()` at the top level of `ai/world/`), so the first room of the night doesn't wait on web search. The server only imports `ai/` when `AI_MODE=muse`.
- **`prepareAiPersona` must resolve within ~10s once the cache is warm.** The server only waits 10s at game start before using its stub persona.
- **One `museResponses` call:**
  - `tools: [{ type: "web_search" }]`
  - `reasoning: { effort: "low" }`
  - structured output via `text.format` with a JSON schema for `{ trending: string[], news: string[], local: string[], weather: string | null }`
  - **Input:** "It is {today's date}. A college student at HackTX at UT Austin this weekend. Find: 6 things people their age are talking about this week (trending topics, games, music, sports, memes), 4 current headlines, 5 Austin/UT-specific current details (events, sports, campus news), today's Austin weather. Short phrases."
  - Then add `fetchedAt` and `hacktx: HACKTX_FACTS`.
- **Timeout 25s.** On failure, return `{ trending: [], news: [], local: [], weather: null, hacktx: HACKTX_FACTS }`. Never throw.
- **Cost:** about 4–8 searches per refresh at $2.50/1,000. Negligible.
- If `text.format` gives trouble, ask for JSON in the prompt and parse it, and keep the fallback.

**`prepareAiPersona` (the `PrepareAiPersona` export):**
```ts
export const prepareAiPersona: PrepareAiPersona = async ({ roomCode, signal }) => {
  try {
    const world = await getWorldContext();
    return await withTimeout(generatePersona(world, museCall), 15000); // Part 2
  } catch { return fallbackPersona(); }                                // Part 2
};
```

## 3. `ai/controller/`: the AI player brain (P0 → C2, the biggest piece)
`createAiPlayer({ roomCode, aiPlayerId, persona, actions }): AiPlayer`.

**The server calls `onEvent(event, view)` on every change.** Keep the latest `view`. Do all async work in the background. **Never throw out of `onEvent`.**

### State you keep
- `persona`, `latestView`, `saidSoFar: string[]`
- `notes: AiNoteView[]`
- `inFlight: boolean`: at most one Muse call for chat at a time. Answers and collab results have their own slot.
- `lastSentAt` (group and pair), `myMessageCount`, plus per-phase human message counts

### Timing model (makes the AI look like a phone typer)
On top of everything below, the server adds `CHAT_DELAY_MS` (5s) to every message for everyone.
- **Reading delay** after the trigger message becomes visible: uniform 1.5–4s.
- **Thinking:** 0.5–2s.
- **Typing time:** `chars / U(4, 7)` chars per second.
- **Extra jitter:** `U(AI_EXTRA_JITTER_MS)`, i.e. 0–4s.
- **`sendAt`** = trigger time + read + think + typing + jitter.
  - Start the Muse call immediately.
  - Send at `max(sendAt, resultReadyAt)`.
- **Stale check:** if the result arrives late and ≥3 newer messages arrived since the trigger and it wasn't `addressedToMe`, drop it and re-decide on the latest message.
- **Never send** if fewer than 4s remain in the phase, and never within 8s of your last group message.

### Per phase
| Phase | Behavior |
|---|---|
| `answer` | **Immediately:** `museCall(buildAnswerRequest(ctx))`, then `humanize`, then `validateOutput` (regenerate once if invalid). Submit at a random time in **[35%, 85%] of the phase** (and after the result is ready). **Deadline guard:** at phase end minus 3s, if nothing has been submitted, submit a random `FALLBACK_LINES.answer[tier]`. Push the text to `saidSoFar` and the note to `notes`. |
| `discuss` | **Opening move:** with 45% probability, 6–14s after the phase starts, call `buildGroupChatRequest` with `trigger: phaseStart` (reacting to the answers). **On each `messageVisible` from a human in `group`:** decide whether to reply (see the cadence rules below). If yes, call `buildGroupChatRequest` with `trigger: message`. If the output is `action: "skip"`, do nothing. |
| `vote` / `finalVote` | **Cast at [30%, 80%] of the phase.** Choose a target (see "Votes and vouches"). |
| `pairChat` | Find your pair in `view.pairs` and your partner(s). **Opening:** 50% probability, 4–10s in. **Reply to each partner message** with 90% probability (the same one-call-in-flight rule). Pair messages are always `addressedToMe`. **Collab result:** at [55%, 85%] of the phase, `buildCollabRequest`, then submit with `submitCollab`. Deadline guard: a `FALLBACK_LINES.collab` line. |
| `pairResults` | Set a vouch for each partner. `true` with 80% probability, at [30%, 70%] of the phase. |
| `reveal` | Stop everything. `getRevealInfo()` is called. |

### Cadence rules (group chat), so the AI talks like an average human, not more
- **`addressedToMe`:** the message contains your nickname (case-insensitive, word boundary, optionally `@`), or quotes your answer. **Reply with 85% probability.**
- **Otherwise:**
  ```
  p = clamp(0.25 + 0.15 * (medianHumanCount - myCount), 0.05, 0.6)
  ```
  using **this phase's** message counts. Roll `p`.
- **Accusations** (the message mentions you plus "bot", "ai", "sus", "robot", "chatgpt" and similar) count as `addressedToMe`. Part 2's prompt handles the tone.

### Votes and vouches
- **Suspicion votes (rounds 1–2):**
  - 60%: vote for the human with the most votes in previous rounds (bandwagon, like people do)
  - otherwise: a random human
  - never yourself (the server rejects it anyway)
- **Final vote:** 70% the most-suspected human who isn't your partner, else random.
- **Add a controller note for each decision**, e.g. `"voted Panda bc everyone already was lol"` or `"vouched for Owl, felt rude not to"`.

### Every AI message goes through this pipeline
1. `museCall(builder(ctx))`
2. `humanize`
3. `validateOutput`. If it fails, regenerate once, then use a fallback line.
4. Wait until `sendAt`.
5. `actions.sendChat(text, channel)`

**Building `AiTurnContext`:**
- `myNickname` comes from `view.me.nickname`.
- `style` = `computeStyleProfile(view.messages, all answers in view.history, aiPlayerId)` (Part 2).
- `secondsLeftInPhase` comes from `view.phaseEndsAt - view.serverNow`.

### `getRevealInfo()`
- **Persona:** `{ name: persona.name, blurb: persona.blurb }`.
- **Notes:** at most 6, chosen in this order:
  1. answer note r1
  2. answer note r2
  3. the most "interesting" discuss note (prefer ones from accused turns, then the longest)
  4. the pair-chat opener note
  5. the vouch note
  6. the final vote note
- Each note ≤ 120 chars.

### `dispose()`
Clear every timer and abort in-flight calls (keep an `AbortController` per call).

## 4. `ai/matchmaker/`: pairing for round 3 (P1 by C3)
**`runMatchmaker(input, { timeoutMs })`:**
1. **Pick the leftover randomly yourself** if the human count is odd. Don't let the LLM choose. It must be unpredictable who gets the AI.
2. **Call `museCall`** with `reasoning_effort: "low"`, `max_completion_tokens` around 1000, `label: "matchmaker"`, and a json_schema output:
   ```json
   { "pairs": [{ "a": "<id>", "b": "<id>", "sharedThing": "<one short line>" }],
     "suggestionForLeftover": { "targetId": "<id>", "reason": "<one short line>" } | null }
   ```
   With strict schemas, model the nullable object as `anyOf: [{...}, {"type": "null"}]` *below* the root.
   - **Prompt:** the humans as `{id, nickname}` with their round 1–2 answers and messages. **Exclude the AI's.**
   - **Goal:** "Pair people who share something specific but talked to each other least. Avoid pairing two people who already chatted a lot. Every listed person exactly once."
   - If there's a leftover, also ask for the best other human for them to talk to after the game, plus a one-line reason ("you both quit piano").
3. **Validate:** every non-leftover human exactly once, every pair size 2, every id known. If invalid, random pairing for the same humans.
4. **Overall timeout:** `timeoutMs` (8s), then random pairing.
5. **Return a `MatchmakerOutput`** (`humanPairs`, `leftover`, `sharedThings`, `suggestionForLeftover`).

## 5. `ai/index.ts` (P0 at C0: stubs; real by C2)
```ts
export { createAiPlayer } from "./controller/createAiPlayer.js";
export { prepareAiPersona } from "./world/prepareAiPersona.js";
export { runMatchmaker } from "./matchmaker/runMatchmaker.js";
```
At C0, if your real versions aren't ready, re-export Part 3's stubs (`../game/stubAi.js`) so `AI_MODE=muse` still boots.

## 6. Content: `content/question-bank.json` (P1, ongoing)
- **Current content:** 14 light, 12 personal and 10 deep questions, plus 7 collaboration cards (see the file's `_readme`).
  - The server validates it against `QuestionBank` in `packages/shared/src/content.ts`.
  - **Keep ids unique.**
- **Add or trim based on playtests:** remove questions that produce one-word answers; add ones that produce stories.
- **Every collab card needs a `submitPrompt`** that works as a one-liner (≤140 chars).
- **Everything must be comfortable for strangers** (judges).

## 7. Submission and pitch (P1 at 11:30pm soft submit; P0 9:30–11:00am Sunday)
Everything goes in `docs/submission/`.

**Soft submission, 11:30pm Saturday:** create the Devpost project, add the team, select tracks (§13 in MASTER_PLAN), and write a short draft. **This deadline is real.**

**`DEVPOST.md`:**
- inspiration (the "nobody goes first" barrier)
- what it does
- how we built it, covering:
  - Muse's 3 roles: world-aware persona via web search, the AI player, the matchmaker
  - the virtual-client design
  - the 5s delay
  - Socket.IO and Next.js
  - Vultr and Caddy
  - the .tech domain
- challenges (making an AI text like a tired college student; latency)
- accomplishments
- what's next (any group: clubs, orientation, remote teams)

**Quote only real numbers** from logs and playtests: games played, median Muse latency, cost per game, how often the AI got caught.

**`VIDEO_SCRIPT.md`:** 2–3 min in Meta's structure:
- problem (~30s)
- demo (~90s)
- AI integration (~30s)
- tools, harnesses and models (~30s): Muse Spark, Claude Code or other coding agents, Next.js, Socket.IO, Vultr

Plan the shots. Record a real game with 4+ people at 9:30am.

**`PITCH.md`:** a 3–5 min pitch for 5:30pm.
1. The barrier.
2. A live game: audience members join via QR, the projector shows `/screen`.
3. The reveal moment.
4. The partner-card handoff.
5. The before/after question to the audience.

## 8. Acceptance criteria
- [ ] `AI_MODE=muse`: the AI answers every round, chats at roughly the median human rate, replies when addressed, handles pair chat, submits a collab result, votes and vouches in every game.
- [ ] With an invalid `MODEL_API_KEY`, the game still completes (fallback lines, random pairing, fallback persona).
- [ ] **No AI message is ever visible less than ~6.5s after its trigger** (read + type time + 5s server delay).
- [ ] The matchmaker returns valid pairs in under 8s, or falls back.
- [ ] `getRevealInfo()` returns a persona and 3–6 funny, honest notes.
- [ ] Logs show per-call latency and tokens. You can state "≈$X per game".
- [ ] The Devpost draft exists before 11:30pm. The final version, video and tracks are submitted by 11:00am Sunday.

## 9. Checkpoints
| Time | Deliverable |
|---|---|
| **C0 (9:30pm)** | `muse.ts` working (one test call logs latency), `ai/index.ts` re-exporting stubs, `hacktx-facts.ts`. |
| **C1 (10:45pm)** | Controller handles `answer` + `discuss` with Part 2's skeleton builders, against the real server. |
| **11:30pm** | **Devpost soft submission.** |
| **C2 (12:30am)** | `AI_MODE=muse` plays rounds 1–2 believably. World context + `prepareAiPersona`. Timing and cadence in place. |
| **C3 (3:00am)** | Pair mode, collab, vouch, final vote, matchmaker, reveal info. |
| **C4 (7–9am)** | Tune cadence and timing from playtests. Collect real numbers for Devpost. |
| **C5 (9:30–11am)** | Video, Devpost final, submit by 11:00. |
