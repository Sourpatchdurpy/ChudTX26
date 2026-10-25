# Development tuning log

## October 25, 2026 — initial implementation

- Prompt versions: `qa-1`, `conversation-1`.
- Implemented the root TypeScript workspace, shared server-only contract migration, five student/nonstudent fallback personas, separate prompt families, Unicode measurements, deterministic memory/retrieval and evidence-backed stance/profile context.
- Added SDK transport, private-answer publisher, readiness-deadline hook and controller support under `ai/runtime/`. The full authoritative server and deployment remain outside this change.
- Baseline policy: minimal reasoning, 800 completion tokens. Higher tiers are implemented behind explicit approved/evaluated policy settings; no higher live tier has been activated.
- Verification uses mocked provider calls and synthetic views. The first test pass found an initials-chain segmentation bug (`Mr. A. B. went home.`), corrected by protecting spaced initial chains.
- Root `npm.cmd run typecheck` passes for `@game/shared` and `@game/ai`. All 56 mocked regression tests pass, covering measurements, prompt routes, persona normalization, memory, private-answer snapshots, cancellation/retry bounds, fallback races, stale-message handling and chat scheduling. Synthetic lab smoke checks ran for answer, group/pair chat, collaboration and invalid-output fallback; outputs are saved in the ignored fixtures directory. These checks are distinct from the pending 50-output live generation evaluation.
- Live generation samples: 0. Completed stranger games: 0; caught games: not measured; catch rate: not measured. Blind identification accuracy: not measured. Provider p50/p90, persona-readiness latency, elevated-tier quality/latency and full-game visibility timing: pending.
- No live evaluation or production transcript logging was performed. The 50-output live evaluation and at least three complete stranger playtests remain pending approval/integration.
