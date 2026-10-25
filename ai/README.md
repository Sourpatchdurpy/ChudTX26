# AI humanness workspace

This workspace implements the Part 2 content layer and the limited runtime prerequisites authorized on October 25, 2026. It does not implement a Socket.IO game server, world searches, matchmaking or deployment. Imports make no network calls. All checks use synthetic/developer fixtures and mocked Muse by default.

From the repository root:

```powershell
npm.cmd install --package-lock=false --cache ai/.npm-cache
npm.cmd run typecheck
npm.cmd run test:ai
npm.cmd run ai:lab -- --fixture accused-1
npm.cmd run ai:lab -- --fixture r1-answer-light --mode answer
```

On Windows, `npm.cmd` avoids PowerShell execution-policy restrictions on `npm.ps1`. Node 22 or newer is sufficient for this workspace; the eventual server plan targets Node 24. Tests cover the actual root exports and shared contracts. `@game/server` is still absent, so no server workspace typecheck or complete-game test has run.

The two editable gameplay templates are `prompts/question-answer.ts` and `prompts/conversation-interrogation.ts`. Both share the prefix in `prompts.ts`. Persona generation is a separate lobby operation. Normal turns make one generation invocation; invalid structured output permits one regeneration. Each invocation permits at most two provider attempts. All attempts and backoff share the caller's cancellation signal and absolute cutoff.

## Server handoff

The real server must wire these exported helpers into its accepted-state mutation path:

1. Allocate a fresh `sessionGeneration` (for example, `crypto.randomUUID()`) for every game, including Play Again. Keep the shuffled roster fixed. Start `preparePersonaWithDeadline({ world, call, deadlineAtMs, fallback: fallbackPersona })` during lobby preparation with the existing readiness deadline. It returns a deeply frozen persona, aborts preparation when readiness expires and ignores late results. Supply cached world context or an empty context; this workspace does not enable searches.
2. Create `createAiPlayer({ sessionGeneration, roomCode, aiPlayerId, persona, actions }, { call })`. Inject the same validated `AiActions` used by human events. Continue to enforce `CHAT_DELAY_MS` for every `sendChat`; the controller supplies reading/thinking/typing/jitter time separately.
3. Deliver internal `GameEvent`s and the AI seat's privacy-filtered `RoomView` to `player.onEvent`. Do not provide a spectator view or other pairs' messages. Server deadlines and `Date.now()` must use the same clock. The controller only accepts views for its own room and seat.
4. Create `createFirstQuestionNotifier(sessionGeneration, shuffledRoster, aiPlayerId, event => player.onEvent(event, buildAiView()))`. After entering round-one `answer` and selecting its prompt, publish once with the authoritative answer map, even when empty. After each successfully accepted human submission/resubmission, publish again after changing that map. Do not publish for invalid or AI submissions. Never connect this callback to a public broadcaster or socket payload.
5. Keep current-round answers hidden in every ordinary view until the normal reveal. The notifier copies accepted human answers in fixed roster order. The controller validates session, prompt, roster, identities and revisions; first-answer construction waits for all humans or the generation reserve. A valid first answer is submitted immediately. At the cutoff it submits a synchronous fallback. Forced advancement cancels work and can leave the AI answer null.
6. Dispose the notifier and player when the game ends or resets. Use a new controller and readiness lifecycle for the next generation. `getRevealInfo()` returns only the reveal persona and up to six notes, and should only be serialized at the existing reveal boundary.

The hooks are executable integration boundaries, not a substitute for the missing authoritative game server. Human/spectator privacy, server validation, phase transitions and complete-game outcomes still require verification after that integration.

## Transport and operational configuration

`createMuseCall` uses the OpenAI-compatible SDK against `https://api.meta.ai/v1`, disables SDK retries and rejects contributor models. `museFromEnvironment` reads `MODEL_API_KEY`, `MUSE_MODEL`, `MUSE_TIMEOUT_MS` and `MUSE_MAX_CALLS_PER_MIN`. It never loads `.env` or prints credentials. The calling server/operator is responsible for loading its environment.

The monetary cutoff is explicitly disabled by default (`budgetUsd: null` or `MUSE_BUDGET_USD=disabled`). A finite nonnegative `MUSE_BUDGET_USD` enables it. A legacy value of `5` still enables a five-dollar cutoff; remove that value or set `disabled` for the authorized uncapped configuration. Spend/token reports, rate caps (default 60 provider attempts/minute), provider quotas, timeouts and bounded retries remain active. Inject `onMetric` to receive metadata without production chat. SDK usage provides estimated spend, including cached-input discounts and reasoning-token counts; unreported usage cannot be reconstructed.

Only the baseline generation policy is enabled by default. Expanded/complex/high tiers require an explicitly approved and evaluated policy with measured p90 times. `highEscalation` additionally enables an evaluated high tier for complex contexts. Pure policy selection supports three-snapshot downward hysteresis and deadlines. No live higher-tier quality or latency claims have been established.

## Lab and evaluation

The lab supports `--fixture`, `--mode`, `--n` (default 3), `--tier`, `--live` and `--yes`. Mock runs use the same builders, validation, cleanup and fallback pipeline as production. Synthetic artifacts go to the ignored `ai/fixtures/outputs/` directory; no production transcript is persisted.

Live mode prints planned calls, the maximum four provider attempts per run, regeneration allowance and a conservative estimate before executing. More than ten possible calls requires `--yes`; even three runs can permit twelve attempts. Higher live tiers also require `--approved-tier`. These flags are operator assertions/execution guards, not substitutes for the human approval required for agent-run live tests. Setting `--tier` permits selection of that tier; actual selection still follows evidence and remaining time.

No live Muse calls, 50-output live evaluation, teammate blind tests or stranger playtests have been run. Mocked validity checks do not establish humanness, catch rate or provider latency. Record those measurements in `TUNING_LOG.md` after approval and server integration. Compare matched baseline/candidate scenarios and separate human-wait, assembly, provider generation/retry, scheduled wait and final visibility times.
