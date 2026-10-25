# Development tuning log

## Remove generated persona names

- Removed `Persona.name` from the shared server-only persona contract, generation schema, normalization, prompt serialization and all five fallback sheets. Removed personal names from fallback blurbs and instructed generation to avoid names throughout its fact sheet.
- Gameplay identity remains the assigned game nickname; the existing reveal display-name field is populated from the game view's nickname. Cleanup no longer depends on a persona-name field. Prompt versions are `qa-3` and `conversation-4`.
- Updated schema, fallback, normalization, readiness and nickname regression checks, including rejection of a returned `name` field and reveal nickname coverage. No live calls were made.

## Nickname identity clarification

- Updated the common developer prefix to supply the game-assigned nickname and require it whenever the AI names or identifies itself in answers, group/pair/trio chat, collaboration results or notes. The persona name stays private identity/reveal metadata. Ordinary first-person pronouns remain natural and do not require repeating the nickname.
- Prompt versions are now `qa-2` and `conversation-3`, reflecting the shared-prefix change. Added regression coverage across all four modes and a changed game nickname. No live calls were made; live quality evaluation remains pending.

## Conversation task-context correction

- Changed conversation prompt version from `conversation-1` to `conversation-2`; the answer family remains `qa-1`.
- Group fixtures previously inherited a food-order round question, and request assembly presented it as an unlabeled `round.prompt`. This could compete with the actual chat trigger. Requests now expose an explicit `activeTask`: answer the current question, reply to the attributed player message, join the conversation, or submit the collaboration result. During group chat the already-answered round question is labeled background; conversation round metadata contains only identifiers.
- Added scenario-specific group round context, corrected pair-message authors, and made lab mode overrides reject incompatible fixtures. Mocked lab replies now vary with the fixture rather than using one generic response.
- Added regression checks for question-versus-conversation task separation, target attribution, pair membership, collaboration submission, fixture mode validation and scenario-specific mock output. No live evaluation was run for this prompt change; relevance/humanness measurements and the approved 50-output live evaluation remain pending.
- Verification: root typecheck and all 60 mocked tests pass. Mocked lab smoke checks for `accused-1`, `discuss-addressed` and `collab-result` completed with distinct scenario-specific outputs and successful validation.

## October 25, 2026 — initial implementation

- Prompt versions: `qa-1`, `conversation-1`.
- Implemented the root TypeScript workspace, shared server-only contract migration, five student/nonstudent fallback personas, separate prompt families, Unicode measurements, deterministic memory/retrieval and evidence-backed stance/profile context.
- Added SDK transport, private-answer publisher, readiness-deadline hook and controller support under `ai/runtime/`. The full authoritative server and deployment remain outside this change.
- Baseline policy: minimal reasoning, 800 completion tokens. Higher tiers are implemented behind explicit approved/evaluated policy settings; no higher live tier has been activated.
- Verification uses mocked provider calls and synthetic views. The first test pass found an initials-chain segmentation bug (`Mr. A. B. went home.`), corrected by protecting spaced initial chains.
- Root `npm.cmd run typecheck` passes for `@game/shared` and `@game/ai`. All 56 mocked regression tests pass, covering measurements, prompt routes, persona normalization, memory, private-answer snapshots, cancellation/retry bounds, fallback races, stale-message handling and chat scheduling. Synthetic lab smoke checks ran for answer, group/pair chat, collaboration and invalid-output fallback; outputs are saved in the ignored fixtures directory. These checks are distinct from the pending 50-output live generation evaluation.
- Live generation samples: 0. Completed stranger games: 0; caught games: not measured; catch rate: not measured. Blind identification accuracy: not measured. Provider p50/p90, persona-readiness latency, elevated-tier quality/latency and full-game visibility timing: pending.
- No live evaluation or production transcript logging was performed. The 50-output live evaluation and at least three complete stranger playtests remain pending approval/integration.
