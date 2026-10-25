# Part 1: Frontend and web app

**Owner:** the UI/frontend person. **You own:** `apps/web/**` (and nothing else).
**Read first:** `docs/MASTER_PLAN.md` (especially §3 game rules), then `packages/shared/src/types.ts` and `events.ts`.

> **Paste this into your coding agent:**
> You are implementing Part 1 (frontend) of a HackTX party game. Read `docs/MASTER_PLAN.md`, `docs/PART_1_FRONTEND.md`, and everything in `packages/shared/src/`. Only create or edit files under `apps/web/`. The server is authoritative. Render every screen purely from the latest `RoomView` received on `room:state`, and send actions with the typed events in `@game/shared`. Never infer or display which player is the AI, a player's real name, or who the host is, except what `RoomView` explicitly gives you. Start with the socket/room provider and the fixture-driven preview route so screens can be built before the server is ready. Mobile-first (375px wide). Ask me clarifying questions instead of guessing, especially about design direction (I already have a UI design in progress, so ask to see it before inventing one) and anything that seems to need a contract change. Follow "Ask before you act" in `CLAUDE.md`.

---

## 1. Setup (P0, by C0 at 9:30pm)
1. **Create the app** from the repo root:
   ```bash
   npx create-next-app@latest apps/web --ts --tailwind --app --eslint --src-dir --import-alias "@/*" --use-npm
   ```
   Accept whatever React and TypeScript versions it installs. Expect Next 16.4, React 19.3 and Tailwind 4.3.
2. **Name the package** `"name": "@game/web"` in `apps/web/package.json`. Add the shared package and the client libraries:
   ```bash
   npm install @game/shared@* socket.io-client@4.8.4 qrcode.react@4.2.0 -w @game/web
   ```
   If npm complains about `@game/shared@*`, add `"@game/shared": "*"` to `dependencies` by hand and run `npm install` at the root.
3. **Transpile the shared package.** `apps/web/next.config.ts`:
   ```ts
   import type { NextConfig } from "next";
   const nextConfig: NextConfig = { transpilePackages: ["@game/shared"] };
   export default nextConfig;
   ```
4. **Env file.** `apps/web/.env.local` contains `NEXT_PUBLIC_SERVER_URL=http://localhost:4000`. In production it's empty, and the socket connects to the same origin.
5. **Scripts.**
   - `"dev": "next dev -p 3000"`. Use `next dev -H 0.0.0.0 -p 3000` for hotspot phone testing.
   - `"build": "next build"`
   - `"start": "next start -p 3000"`
   - `"typecheck": "tsc --noEmit"`

## 2. Socket and room state layer (P0)
Build this first. Every screen depends on it.

**`src/lib/socket.ts`**: one typed singleton.
```ts
"use client";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@game/shared";
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
export function getSocket() {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_SERVER_URL || undefined; // undefined = same origin
    socket = io(url, { transports: ["websocket"], autoConnect: true });
  }
  return socket;
}
```

**`src/lib/RoomProvider.tsx`**: a React context, client-only.
- **State:** `view: RoomView | null`, `connected: boolean`, `clockOffsetMs` (`view.serverNow - Date.now()` on every snapshot), `error: string | null`.
- **Session:** save `{ code, token }` to `sessionStorage` (key `game:session`) after create or join succeeds.
  - Use `sessionStorage`, not `localStorage`, so each tab is a separate player.
  - Only touch storage inside `useEffect`.
- **Reconnects:** on `connect` (including reconnects), if a session exists, emit `room:rejoin`. If that fails, clear the session and go home.
- **Room closed:** on `room:closed`, clear the session, show a toast, and go to `/`.
- **Actions:** wrap each event in a promise helper.
  ```ts
  function emitAck<E extends keyof ClientToServerEvents>(...)  // resolves the AckResult
  ```
  Expose `create(realName)`, `join(code, realName)`, `watch(code)`, `start()`, `submitAnswer(text)`, `sendChat(text, channel)`, `vote(targetId)`, `submitCollab(text)`, `setVouch(targetId, vouched)`, `advance()`, `playAgain()`.
- **Countdown hook:** `useCountdown(phaseEndsAt, clockOffsetMs)` returns the seconds left, updating every 250ms.
- **Pending messages:**
  1. When `sendChat` acks with `{ messageId, visibleAt }`, keep a local "sending…" bubble.
  2. Remove it once a message with that `id` appears in `view.messages`.
  3. Drop it on the next phase change.

## 3. Routes

| Route | Purpose |
|---|---|
| `/` | Home: "Create game" (asks your first name) or "Join game" (code + first name). |
| `/join/[code]` | QR deep link: the code is prefilled, you just type your name. |
| `/play/[code]` | The player game screen. Switches on `view.phase`. |
| `/screen/[code]` | Big-screen spectator: calls `watch(code)`, has no inputs, shows large text for a projector or laptop. |
| `/dev/[phase]` | Dev only: renders the player screen for a phase from fixtures (§6). |

## 4. Player screens by phase (P0 unless marked)
Every screen has a header with your own `emoji nickname` (from `view.me`), the round ("Round 2/3") and a countdown bar from `phaseEndsAt`.

| Phase | Show | Actions |
|---|---|---|
| `lobby` | Room code (huge), QR to `${origin}/join/${code}`, list of `lobby.realNames`, "Waiting for host…" | **Host only** (`me.isHost`): "Start" (disabled under `lobby.minHumans`), a link "Open big screen" → `/screen/CODE` |
| `answer` | Prompt card (`round.prompt`), textarea with a counter (≤ `LIMITS.answerMaxChars`), "3/5 answered" (`answerProgress`) | Submit / "Update answer" (`submitAnswer`). Show your submitted answer. |
| `discuss` | The current round's answers from `history.at(-1).answers`, in the given order, as cards (`emoji nickname: answer`; `null` → "(no answer)"). Group chat feed below (`messages` where `channel === "group"`). | Chat input (≤ `LIMITS.chatMaxChars`), "sending…" bubbles |
| `vote` | "Who's the AI?" grid of every player except you (emoji + nickname), "4/5 voted" | Tap to vote, tap another to change (`vote`). Highlight `me.myVote`. |
| `voteResult` | Vote counts per nickname (bars), "Nobody leaves. Next round coming up." | (none) |
| `pairChat` | Collab card (`round.prompt`) and "Your partner: 🦉 Owl" (from `pairs` + `me.myPairId`; trio = two partners). A private chat showing only `channel === "pair"` messages. Submit box labeled with `round.submitPrompt` (≤ `LIMITS.collabMaxChars`). | Pair chat input, submit or update result (`submitCollab`) |
| `pairResults` | Every pair: member nicknames and each member's `collabResults[id]` | A vouch toggle per partner: "I vouch 🦉 Owl is human" (`setVouch`); reflect `me.myVouches` |
| `finalVote` | Vouches list ("🦉 Owl vouched for 🦊 Fox ✅" / "didn't vouch"), then the vote grid as in `vote` | Vote |
| `reveal` | Animated sequence from `view.reveal` (§5) | **Host:** "Show partner cards" (`advance`) |
| `partners` | Your `me.partnerCard` (§5) | **Host:** "Play again" (`playAgain`) |

**Host-only "Skip ⏭" (P1):** a small button in the header during any timed phase that calls `advance()`. It's for judging demos.

**Chat UX rules (these matter for the game, not just looks):**
- **Never show:**
  - typing indicators
  - read receipts
  - online/offline status of others
  - exact message timestamps
  - who answered or voted first
- Render answers in the order the server sends them.
- Messages are bubbles with `emoji nickname`. Your own messages align right.
- Previous rounds collapse into a "Round 1 answers ▸" accordion, so people can scroll back to catch inconsistencies.
- The input stays usable with the iOS keyboard open: use `100dvh` layouts and keep the input at the bottom.

## 5. Reveal and partner card (P0: the payoff screens, polish them)
**Reveal sequence** (`view.reveal`), with steps that animate in one by one (~1.2s apart). Tap to skip ahead.
1. Final vote bars (`finalVoteCounts`).
2. Big banner: **"You caught it!"** (`humansWon`) or **"The AI fooled you 🤖"**.
3. "🦊 Fox was the AI", with `aiPersona.blurb` ("posing as Jordan, sophomore CS from Houston").
4. The real-name grid: every human nickname to `realNames[id]`. This is the "wait, YOU said that?" moment.
5. The AI's notes (`aiNotes`) as quote cards.
6. Call-outs:
   - "🦉 Owl vouched for the AI 😬" (`vouchedForAi`)
   - "Detectives: 🐼 Panda (rounds 1, 3)" (`suspectedBy`)
   - "Most suspicious human: 🐸 Frog (5 votes)" (`mostSuspiciousHuman`)

**Partner card** (`me.partnerCard`). Make it big and warm. It should make people walk over to each other.
- **`kind: "partner"`:**
  - "Your partner 🦉 Owl was **Maya**"
  - What you two found: `partners[i].collabResult` and `myCollabResult`
  - "Go say hi 👋"
  - In a trio, list both partners. If `aiWasInMyPair`, add "(the AI was in your trio too)".
- **`kind: "aiPartner"`:** "Your partner was the AI 🤖." If there's a `suggestion`: "But you and **{suggestion.realName}** {suggestion.reason}. Go find them 👋".

## 6. Fixtures and preview route (P0, do this right after the provider)
Create `src/dev/fixtures.ts` with one realistic `RoomView` per phase: 5 players (4 humans + AI), real-looking answers and chat, and `me` set to one human. In round 3 include a trio, plus reveal and partner-card data for both kinds.
- `/dev/[phase]` renders the player screen with that fixture. It doesn't touch the socket.
- This lets you design every screen before the server exists (Part 3 reaches C1 around 10:45pm).
- Keep the fixtures matching the contract types. TypeScript will tell you when the contract changes.

## 7. Big-screen view `/screen/[code]` (P1, by C3)
Calls `watch(code)` and gets `RoomView` with `me === null`, plus group chat only.

| Phase | Show |
|---|---|
| `lobby` | Huge QR and code, list of names |
| `answer` | The prompt and the answered count |
| `discuss` | The answers grid and the live group chat |
| `vote` / `finalVote` | "Voting…" and the voted count |
| `voteResult` | Bars |
| `pairChat` | The collab card, the pairs list by nickname, a countdown (never pair messages, which the server doesn't send) |
| `pairResults` / `finalVote` | Results and vouches |
| `reveal` | The same sequence, large |
| `partners` | "Go find your partner 👋" and the list of nickname → real name pairs |

This is what the pitch audience watches on the projector, so use large type and high contrast.

## 8. Design notes
- **Mobile first** (375×700). Tap targets ≥44px. One primary action per screen.
- **Colors:** give every nickname a consistent color (hash the nickname). Never color the AI differently before reveal.
- **Phase changes:** a short transition and a big title ("Round 2: Personal"). Optionally call `navigator.vibrate(50)` (Android only).
- **Copy tone:** playful, short, Gen Z, not cringe.
- **Theme:** your call. The HackTX theme is "Once Upon a Hack" (fairytale) if you want a nod to it.

## 9. Acceptance criteria
- [ ] With the server running in `AI_MODE=stub`, 3 browser tabs and the stub AI can play from lobby to partners with no console errors.
- [ ] Refreshing any tab mid-game puts you back in the same seat and phase.
- [ ] Countdowns stay correct (clock-offset corrected) even if the laptop clock is off.
- [ ] Your own chat message shows "sending…" for about 5s, then appears in the feed exactly once.
- [ ] Nothing in the UI before `reveal` reveals the AI, real names, or the host to non-hosts.
- [ ] `npm run build -w @game/web` passes. Part 3 runs it on the VM.
- [ ] Works on iOS Safari and Android Chrome: keyboard doesn't cover the input, no horizontal scroll.

## 10. Checkpoints
| Time | Deliverable |
|---|---|
| **C0 (9:30pm)** | App scaffold, provider, socket, fixtures for 2–3 phases, `/dev/[phase]` route. |
| **C1 (10:45pm)** | Home, lobby, answer, discuss, vote, voteResult working against the real server. |
| **C2 (12:30am)** | Works on phones via the Vultr deploy. Rejoin works. |
| **C3 (3:00am)** | pairChat, pairResults, finalVote, reveal, partners, host skip, play again, `/screen` view. |
| **C4–C5** | Polish from playtest feedback. Help record the video. |
