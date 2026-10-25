# Instructions for coding agents (Claude Code, Cursor, etc.)

This repo is a HackTX '26 project: a party chat game where one player is secretly an AI and the group must vote it out. Four people work in parallel, each with their own coding agent.

**Before writing any code:**
1. Read `docs/MASTER_PLAN.md` in full.
2. Read your part's brief:
   - Part 1, frontend: `docs/PART_1_FRONTEND.md`
   - Part 2, AI humanness: `docs/PART_2_AI_HUMANNESS.md`
   - Part 3, game server and deploy: `docs/PART_3_GAME_SERVER_DEPLOY.md`
   - Part 4, AI runtime, content and submission: `docs/PART_4_AI_RUNTIME_CONTENT.md`
3. Read `packages/shared/src/` (the contract every part builds against).
4. For hackathon rules, Meta's problem statement and its judging rubric, see `docs/reference/`.

**Ask before you act.** Ask the human clarifying questions instead of guessing whenever:
- the request is ambiguous, or the docs and the code disagree
- a change would touch another part's files or `packages/shared/`
- a change alters game rules, timers, or what players can see

**Muse credits are limited:** each teammate has only $50 of Meta API credit, and the deployed game runs on Part 4's key (MASTER_PLAN §8.1). **Stop and ask first, stating the estimated number of Muse calls and cost**, before you:
- run anything that calls Muse more than ~10 times: ai-lab with `--n` above 3, batch evals, blind tests, loops, bots against a server in `AI_MODE=muse`, or load tests
- raise `reasoning_effort` above what the docs specify, or `max_completion_tokens` above 1000
- turn on `web_search`, or call it anywhere other than the cached world-context fetch
- add a new kind of Muse call, change retry logic, or add anything that calls Muse on a timer or interval
- switch a shared or deployed server to `AI_MODE=muse`, or use someone else's API key
- write a test that hits the real API. Tests mock Muse by default.

Default to `AI_MODE=stub` and mocked Muse for everything that doesn't specifically need real responses. Never put API keys in code, logs, commits or chat.

**Rules:**
- Only edit files your part owns (see the ownership map in MASTER_PLAN §5). Need a change elsewhere? Say so; don't make it.
- Never change `packages/shared/` unless you are Part 3. Contract changes get announced to the whole team first.
- **Privacy rule:** nothing sent to a browser may reveal which player is the AI, anyone's real name, or who the host is, before the `reveal` phase.
- **The AI must never stall the game:** every Muse call has a timeout and a fallback.
- **Don't add scope:** no database, logins, points, photo or voice rounds, SerpApi, Gemini, hangout planning, or any tech added only to qualify for a prize track (see MASTER_PLAN §4).
- Run `npm run typecheck` before pushing. Commit small and often. Pull before you push. Never force-push `main`.
- **Secrets** live in the root `.env` (never commit it). Copy `.env.example`.

**Run locally:** `npm install && cp .env.example .env && npm run dev` (server :4000, web :3000). `AI_MODE=stub` needs no API key.
