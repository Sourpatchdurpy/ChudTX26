# Part 3: Game server, realtime and deployment

**You own:**
- the root `package.json`, `.env.example` and `CLAUDE.md`
- `packages/shared/**` (**you are the contract owner**)
- `apps/server/` except `apps/server/src/ai/**`
- `apps/server/scripts/bots.ts`
- `deploy/**`

**Read first:** `docs/MASTER_PLAN.md` (all of it, especially §3 rules, §5 architecture and §7 contract rules), then every file in `packages/shared/src/`.

> **Paste this into your coding agent:**
> You are implementing Part 3 (the authoritative game server and deployment) of a HackTX party game. Read `docs/MASTER_PLAN.md`, `docs/PART_3_GAME_SERVER_DEPLOY.md` and all of `packages/shared/src/`. Implement the server in `apps/server/src/` (not `src/ai/`, which belongs to Parts 2 and 4) with Node, TypeScript (run via tsx) and Socket.IO 4.8.4, using the typed events and types from `@game/shared` exactly. The server holds all state in memory, runs the phase state machine with timers, and after every change emits a per-viewer `RoomView` snapshot (`room:state`) built by one privacy-safe view builder. The AI seat is a "virtual client" driven through the `AiPlayer` / `AiActions` interfaces. Default to `AI_MODE=stub` so nothing waits on the AI. Then do the Vultr + Caddy + pm2 deployment using the templates in `deploy/`. Ask me clarifying questions instead of guessing, especially before any change to `packages/shared/` (it affects all four parts). Ask before switching the deployed server to `AI_MODE=muse` or putting anyone's API key on it. Follow "Ask before you act" in `CLAUDE.md`.

---

## 1. Repo skeleton (P0, push by C0 at 9:30pm. Everyone is waiting on this.)
1. **Create the repo with the starter kit:** `CLAUDE.md`, `docs/`, `packages/shared/`, `content/`, `deploy/`, root `package.json`, `.env.example`.
2. **`apps/server/package.json`:**
   ```json
   {
     "name": "@game/server", "private": true, "type": "module",
     "scripts": {
       "dev": "tsx watch src/index.ts",
       "start": "tsx src/index.ts",
       "bots": "tsx scripts/bots.ts",
       "ai:lab": "tsx scripts/ai-lab.ts",
       "typecheck": "tsc --noEmit"
     },
     "dependencies": { "@game/shared": "*", "socket.io": "4.8.4", "zod": "^4.6.7", "nanoid": "^6.0.2", "openai": "^7.43.0" },
     "devDependencies": { "tsx": "^4.23.15", "typescript": "^5.9.3", "@types/node": "^24", "socket.io-client": "4.8.4" }
   }
   ```
   `openai` is used by Part 4 and Part 2. Installing it now avoids lockfile conflicts.
3. **`apps/server/tsconfig.json`:** same compiler options as `packages/shared/tsconfig.json`, plus `"types": ["node"]`, with `"include": ["src", "scripts"]`.
4. **Env:** load the root `.env` with Node's built-in loader at the top of `src/index.ts`:
   ```ts
   try { process.loadEnvFile(new URL("../../../.env", import.meta.url)); } catch {}
   ```
5. **Placeholders** so imports resolve on day one (Parts 2 and 4 overwrite them):
   - `src/ai/index.ts` containing `export { createAiPlayer, prepareAiPersona, runMatchmaker } from "../game/stubAi.js";`
   - an empty `src/ai/player/index.ts`

   Tell Parts 2 and 4 when the skeleton is pushed.
6. `npm install` at the root, `npm run dev` works, and `GET /health` returns `{ "ok": true, "aiMode": "stub" | "muse" }`. The bots script reads `aiMode`.

## 2. Server structure
```
apps/server/src/
  index.ts            http server + Socket.IO (CORS from CORS_ORIGIN), /health, loads content, picks AI impl by AI_MODE
  net/handlers.ts     socket event handlers → validate (zod) → call Room methods → ack
  game/Room.ts        Room class: players, phase, timers, rounds, messages, votes, pairs, vouches, AI seat
  game/phases.ts      phase table + transition logic (enter/exit actions)
  game/view.ts        buildView(room, viewerId | null): RoomView   ← THE privacy boundary
  game/reveal.ts      RevealPayload + PartnerCard assembly
  game/pairing.ts     apply MatchmakerOutput → Pair[] (AI insertion rules), random fallback
  game/content.ts     load + zod-validate content/question-bank.json, pick prompts per round
  game/rooms.ts       Map<RoomCode, Room>, code generation, TTL cleanup
  game/stubAi.ts      StubAi implementing AiPlayer + stub PrepareAiPersona/RunMatchmaker (AI_MODE=stub)
scripts/bots.ts       fake humans for testing
```

## 3. Room model (in memory)
```ts
interface Seat {
  id: PlayerId; token: string; realName: string; isAi: boolean; isHost: boolean;
  nickname?: string; emoji?: string; socketIds: Set<string>; connected: boolean;
}
```
**A room holds:**
- `code`, `seats` (in **shuffled order** after start), `phase`, `phaseEndsAt`, `timer`
- `roundIndex`, `rounds: RoundRecord[]`, `currentRound: CurrentRound | null`
- `answers: Map<PlayerId, string>` (current round)
- `messages: ChatMessage[]` (released only), `pending` (queued messages)
- `votes: Map<PlayerId, PlayerId>` (current vote phase) and `voteHistory` (round → votes)
- `pairs: Pair[]`, `collabResults`, `vouches`
- `ai: AiPlayer | null`, `personaPromise`, `matchmakerPromise`
- `usedPromptIds: Set<string>`, `lastActivityAt`

**Tokens:** `nanoid(21)`. **Player ids:** `nanoid(10)`. **Room codes:** 4 chars from `ROOM_CODE_ALPHABET`, regenerated on collision.

## 4. Events (`net/handlers.ts`)
**For every client → server event:**
1. Validate the payload with zod.
2. Identify the seat from the socket (a map from socket id to `{code, playerId}`).
3. Check the phase.
4. Mutate the room.
5. `ack(...)`. **Always ack**, even on errors.
6. `room.broadcast()`.

| Event | Rules |
|---|---|
| `room:create` | Trim the real name (1–`LIMITS.realNameMaxChars`). Create the room. The creator gets a host seat. Join the socket to Socket.IO room `code`. Kick off `room.personaPromise = prepareAiPersona({ roomCode })`. |
| `room:join` | Lobby only, at most `LIMITS.maxHumans` humans. |
| `room:rejoin` | Find the seat by token. Attach the socket. Mark connected. |
| `room:watch` | Spectator socket set. Gets `buildView(room, null)`. |
| `game:start` | Host, lobby, ≥ `minHumans` humans. See §5 "start". |
| `answer:submit` | `answer` phase. Trim, ≤ `answerMaxChars`. Overwrites the previous answer. If everyone (AI included) has answered, set `phaseEndsAt = now + 2000`. |
| `chat:send` | `group` in `discuss`; `pair` in `pairChat` and only for pair members. Trim, ≤ `chatMaxChars`. Create the message with `visibleAt = now + CHAT_DELAY_MS`. Queue it. On release: push to `messages`, broadcast, and notify the AI with `{type: "messageVisible"}`. Release even if the phase has changed by then. Ack `{ messageId, visibleAt }`. |
| `vote:cast` | `vote` / `finalVote`. The target must be another seat. Overwrites. If everyone has voted, end the phase in 1.5s. |
| `collab:submit` | `pairChat`. ≤ `collabMaxChars`. Overwrites. |
| `vouch:set` | `pairResults`. The target must be in your pair. |
| `host:advance` | Host only. End the current timed phase now. In `reveal`, go to `partners`. |
| `host:playAgain` | Host only, in `partners`. Dispose the AI, remove the AI seat, clear the game state, back to `lobby` with the same humans. Start a new `prepareAiPersona`. |
| `disconnect` | Remove the socket from its seat. `connected = false` if no sockets are left. Keep the seat. |

**The AI acts through `AiActions`.** Implement `AiActions` by calling **the same internal Room methods** the handlers call (not the sockets), with the AI's seat id. Return the same `AckResult`. Every rule applies to the AI too: delay, limits, phase checks.

## 5. Phase state machine (`game/phases.ts`)
Timers: `duration = DEFAULT_TIMERS[phase] * TIMER_SCALE`. On every phase entry:
1. Set `phase`.
2. Set `phaseEndsAt` (or null).
3. Schedule `setTimeout(next, duration)`.
4. Run the phase's entry actions.
5. Broadcast.
6. `ai.onEvent({ type: "phaseChanged", phase, round }, buildView(room, aiId))`.

| From → To | Entry actions |
|---|---|
| **start** → `answer` (r1) | Add the AI seat (`isAi: true`, realName unused). Assign shuffled `NICKNAMES` to **all** seats. Shuffle seat order. Await `personaPromise` for at most 10s; if it isn't ready, use `STUB_PERSONA` from `stubAi.ts` (rare, since it normally finishes during the lobby). `room.ai = createAiPlayer({ roomCode, aiPlayerId, persona, actions })`. Send the AI `{type: "gameStarted"}`. Pick the round 1 prompt (`light`). Create the `RoundRecord` with empty answers. |
| `answer` → `discuss` | Copy the answers into the current `RoundRecord.answers`, **in seat order**, one per seat (`null` if missing). |
| `discuss` → `vote` | Clear votes. **If this is round 2:** start the matchmaker now (`runMatchmaker(input, { timeoutMs: 8000 })` → `room.matchmakerPromise`). |
| `vote` → `voteResult` | Count votes. Store them in `RoundRecord.voteCounts` and `voteHistory`. |
| `voteResult` → `answer` (r2) | Pick the `personal` prompt. New `RoundRecord`. |
| `voteResult` (r2) → `pairChat` | Await `matchmakerPromise` (it already has an 8s timeout; on reject use random). `pairs = applyPairing(output, humans, aiId)`. Pick a `collab` card and substitute `{deep}`. `currentRound = { number: 3, tier: "collab", prompt, promptId, submitPrompt }`. Push a `RoundRecord` with `answers: []`. |
| `pairChat` → `pairResults` | Freeze `collabResults` (missing → `null`). |
| `pairResults` → `finalVote` | Freeze vouches. Clear votes. |
| `finalVote` → `reveal` | Count the final votes. `humansWon = aiVotes > maxHumanVotes`. Build the `RevealPayload` (§7) using `ai.getRevealInfo()`. No timer. |
| `reveal` → `partners` | Host advance only. Build a `PartnerCard` per human. |

The **round 3 vote is the only one that decides the game.** Rounds 1–2 never remove anyone.

## 6. View builder (`game/view.ts`): the privacy boundary
`buildView(room, viewerId | null)` builds a fresh `RoomView` every time (no caching needed at this scale).

**Never leak, before `reveal`:**
- which seat is AI
- real names (except the viewer's own `me.realName`, and the lobby list in `lobby`)
- the host flag of others
- connection status
- submission or vote **timing or order**
- other pairs' messages
- the current round's answers before `discuss`

**Rules:**
- `players`: `[]` in lobby; afterwards seats in shuffled order as `{ id, nickname, emoji }`.
- `lobby`: only in `lobby`. `realNames` of the human seats.
- `messages`: all `group` messages, plus pair messages whose `pairId === viewer's pair`. Spectators get group messages only.
- `answerProgress` / `voteProgress`: counts only, AI included in both numbers.
- `collabResults`: from `pairResults` on. `vouches`: from `finalVote` on. `reveal`: in `reveal` and `partners`.
- `me.partnerCard`: in `partners` only.
- `serverNow: Date.now()` every time.

**Write a quick self-check (`npm run check:privacy` or a tiny test):** build views for every phase with the stub game and assert that no AI id appears outside its normal `players` entry, and that no other human's real name appears before reveal. Serialize to JSON and grep.

## 7. Reveal and partner cards (`game/reveal.ts`)
**`RevealPayload`:**
- `finalVoteCounts`: from the final vote
- `realNames`: humans only
- `aiPersona` and `aiNotes`: from `ai.getRevealInfo()`. Cap notes at 6. On error, use `{ name: "the AI", blurb: "" }` and `[]`.
- `suspectedBy`: humans who voted for the AI, with rounds `[1, 2, 3]` (3 = final)
- `vouchedForAi`: humans with `vouched: true` targeting the AI
- `mostSuspiciousHuman`: the human with the max total votes received across all 3 votes. Ties: pick any. `null` if 0.

**`PartnerCard` for each human:**
- **`kind: "partner"`** if their pair has ≥1 other human. List those humans with their nickname, real name and collab result. `aiWasInMyPair` is set if the AI was in the trio.
- **`kind: "aiPartner"`** if the AI was the only partner. Set `suggestion` from `MatchmakerOutput.suggestionForLeftover` (resolve the real name), or fall back to a random other human with reason "answered round 1 the same way you did" (only if true; otherwise the generic "had the most interesting answer in round 2").

## 8. Pairing (`game/pairing.ts`)
**`applyPairing(out: MatchmakerOutput | null, humans: PlayerId[], aiId: PlayerId): Pair[]`:**
1. **Validate** `out`: every human appears exactly once across `humanPairs` plus `leftover`; pairs are size 2; `leftover` is non-null iff the human count is odd. If invalid or null, use random pairs (shuffle, chunk by 2, odd one out = leftover).
2. **Odd humans:** `[leftover, aiId]` becomes its own pair.
3. **Even humans:** push `aiId` into a **random** human pair, making a trio.
4. **Pair ids:** `nanoid(8)`.

**Matchmaker input** (built when entering round 2's `vote`):
- `humans` with `{ id, nickname, realName }`
- `aiPlayerId`
- `rounds` (r1, r2 with answers)
- all group messages

**The leftover must be random, not chosen by the LLM.** Part 4's matchmaker handles this, but double-check during validation.

## 9. Stub AI (`game/stubAi.ts`, P0, used when `AI_MODE=stub`)
It exports **the same three names as `src/ai/index.ts`** (`createAiPlayer`, `prepareAiPersona`, `runMatchmaker`), so the two modules are interchangeable, plus `STUB_PERSONA`.
- `STUB_PERSONA`: a hard-coded, believable `Persona`. It's also the timeout fallback at game start.
- `prepareAiPersona` resolves `STUB_PERSONA` after ~1s.
- `createAiPlayer` returns an `AiPlayer` that:
  - submits a canned answer 5–15s into `answer`
  - sends 1–2 canned group messages during `discuss`
  - replies once in `pairChat` and submits a canned collab result
  - votes randomly (never itself)
  - vouches `true`
  - `getRevealInfo` returns a fixed persona and two notes
  - clears all timers in `dispose()`
- `runMatchmaker` returns a random valid pairing.

`index.ts` picks the implementations:
```ts
const ai = process.env.AI_MODE === "muse" ? await import("./ai/index.js") : await import("./game/stubAi.js");
```
**Note:** tsx resolves `.js` to `.ts`.

## 10. Bots (`scripts/bots.ts`, P1 by C1/C2)
`npm run bots -w @game/server -- --room ABCD --count 3 [--url http://localhost:4000]`
- Each bot is a `socket.io-client` that joins with a fake name ("Bot Ana"…).
- **It behaves like a sloppy human:**
  - answers after a random 3–20s
  - sends 0–3 group messages per discuss
  - votes randomly
  - chats and submits in pairChat
  - vouches randomly
- **It never starts the game.** You start it from a browser tab as host.
- **Budget guard:** before joining, it fetches `/health`. If `aiMode` is `"muse"`, it exits with a warning unless run with `--allow-muse`. Every bot game against a real-AI server spends Muse credits (~$0.10–0.20 per game).
- **Use it to run full games solo,** and to load-test 3 rooms at once.

## 11. Room cleanup and robustness
- **TTL sweep every 60s:** delete rooms idle for longer than `ROOM_TTL_MS`. Emit `room:closed`, then `ai.dispose()`, then clear timers.
- **Wrap every timer callback and every AI call site in try/catch.** A thrown error must never kill the process or freeze a room. Log and continue to the next phase.
- `process.on("unhandledRejection", log)` and `process.on("uncaughtException", log)` (don't exit).
- **Log one line per phase change:** `[ABCD] r2 vote → voteResult (5 players)`. Also log AI latency lines from Part 4. **No chat content in logs in production.**
- *(P2)* **Host transfer:** if the host is disconnected for 15s, make the first connected human host.
- *(P2)* **Chat rate limit:** 1 message per 1.5s per seat.

## 12. Deployment on Vultr (P0 first deploy by C2 at 12:30am; domain + HTTPS by C3)
1. **Claim Vultr credits** via **mlh.link/vultr**. Create a **Cloud Compute** instance:
   - Ubuntu 24.04
   - **2 vCPU / 4 GB** (`next build` needs memory)
   - the closest US region (Dallas)
   - your SSH key added
2. **Run `deploy/setup-vultr.sh`** on the VM as root. It installs Node 24, pm2 and Caddy, and opens ports 22, 80 and 443.
3. **Clone the repo** to `/opt/game`. Create `/opt/game/.env` from `.env.example` (start with `AI_MODE=stub`). Run `deploy/deploy.sh`, which does `npm ci`, builds the web app, and runs `pm2 startOrReload deploy/ecosystem.config.cjs`.
   - **The deployed server uses Part 4's Muse key** (team decision). When you're ready for the real AI, Part 4 adds `MODEL_API_KEY` and `MUSE_BUDGET_USD` to `/opt/game/.env` themselves.
   - Then set `AI_MODE=muse` and run `pm2 restart game-server`.
4. **Before the domain works:** test at `http://<VM_IP>`. The Caddyfile has a `:80` block for this. Phones on any network can play.
5. **Domain (MLH .Tech):**
   1. Register the name at **get.tech/mlh** (the team picks it; creative counts for the prize).
   2. In the registrar's DNS, add an `A` record for `@` (and `www`) pointing to the VM IP.
   3. Put the domain in `/etc/caddy/Caddyfile` (template in `deploy/Caddyfile`) and `systemctl reload caddy`. Caddy gets HTTPS automatically once DNS resolves.
6. **Redeploy** = `ssh` in, then `cd /opt/game && git pull && bash deploy/deploy.sh`. **After C5, redeploy only for critical fixes.**

## 13. Acceptance criteria
- [ ] 3 browser tabs plus the stub AI play a full game: lobby, all phases, reveal, partners, play again, all from the frontend.
- [ ] `room:rejoin` restores the exact seat and phase after a refresh.
- [ ] Chat messages appear for everyone exactly `CHAT_DELAY_MS` after send, AI messages included.
- [ ] The privacy check passes for every phase.
- [ ] Killing Muse (bad API key) with `AI_MODE=muse` still lets the game finish (fallbacks).
- [ ] Two rooms run at the same time without interference.
- [ ] The deployed site works on iOS and Android over HTTPS on the .tech domain.

## 14. Checkpoints
| Time | Deliverable |
|---|---|
| **C0 (9:30pm)** | Skeleton pushed (§1). Server boots. `room:create` / `join` / `rejoin` / `watch` and lobby broadcasts work. |
| **C1 (10:45pm)** | Rounds 1–2 fully working with the stub AI and the chat delay. Bots script. |
| **C2 (12:30am)** | Real AI plugged in (`AI_MODE=muse`, with Part 4). **First Vultr deploy on HTTP by IP.** |
| **C3 (3:00am)** | Round 3 (pairing, pair chat, results, vouches, final vote), reveal, partner cards, play again, TTL cleanup, privacy check. Domain + HTTPS. |
| **C4–C5** | Fix playtest bugs. Tune `DEFAULT_TIMERS` with the team. Freeze the deploy at C5. |
