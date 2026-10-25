# ChudTX26
HackTX26 repository for Nathan Tan, Gengwen Li, Sanjey Manian, and Bradley Ngyuen

Run `npm install` and `npm run dev` to start the root Vite frontend at
`http://127.0.0.1:3000` and the game server at `http://localhost:4000`.
Use `npm run dev:web` or `npm run dev:server` to start either separately.
The frontend lives in `src/`; there is no `apps/web` workspace.
Run `npm run build` to check frontend/workspace TypeScript and create the Vite
production build in `dist/`. `npm run build:web` is an alias for that build.
Run `npm run test:ai` and `npm run test:server` for mocked AI and server tests.

For offline development, set `AI_MODE=stub` in the root `.env` (see `.env.example`).
Starting the two services together does not connect the frontend's localStorage
room flow to Socket.IO; that integration remains separate, as described below.

The arcade entry screen generates a codename and defaults to Join Room.
Hosts register a four-character uppercase alphanumeric code by creating a lobby;
rerolling a code alone does not register it. Unknown codes, duplicate codenames,
code collisions, and rooms with six players are rejected with an entry error.
`onEnter({ nickname, roomCode, isHost })` may return a Promise and reject with a
user-facing error. The lobby opens only after validation succeeds.

For frontend testing, rooms and rosters are stored in localStorage. Create a
lobby, then open the same origin in another tab of the same browser and join
using that code. With at least three players, the host can launch once and all
joined tabs automatically enter chat. One stored launch timestamp synchronizes
the 50-second discussion and 20-second voting countdowns. Messages sync across
tabs after the five-second composer hold. Late joins are blocked until the host
reopens the lobby; duplicate launch clicks do not restart the timer or clear chat.
Leaving as host closes the room. A server is still required for cross-device
rooms, robust presence, server questions, and the secret AI.
No authentication or game engine is
connected yet. The direct `?preview=lobby` and `?preview=chat` links show UI
previews and do not register joinable rooms.
Questions must come from the engine; players do not set questions or timers.
Discussion rounds last 50 seconds.

The discussion component remains available for game-engine integration.
It accepts dynamic question, answers, messages, and currentUserNickname props.
`onSendMessage(text)` fires after a five-second release hold and
`onDiscussionEnd()` fires once at zero. The timer is fixed at 50 seconds.
Use a new React `key` to reset a round. `initialSeconds` can resume a round
between 0 and 50 seconds. `DiscussionMsg.timestamp` uses epoch milliseconds;
`RoundAnswer.authorNickname` is the answer's display codename. Theme is controlled
through `isDarkMode` and `onToggleTheme`, shared with entry and the lobby.
Omitting `onSendMessage` makes the discussion read-only. Shared interfaces live in
`src/types/game.ts`.

`PrivateAnswerView` accepts the server question, round number/tier, total players,
and answered tally. It exposes no other players' answers. The timer defaults to
35 seconds (with a bounded `initialSeconds` for resuming), drafts cap at 280
characters, and successful submission locks the answer until the round changes.
`onSubmitAnswer` publishes the private answer and `onTimeUp` ends the phase.
The standalone `?preview=answer` route previews this screen with the current
player's input and transitions to chat after 35 seconds. Room launch still uses
the existing chat flow until server-provided question/answer phases are connected.

`RoundVoteModal` overlays the chat after discussion. Its twenty-second clock is
controlled by `secondsRemaining`; the parent excludes the current user from the
dynamic candidates. One selection locks a vote. Local test rooms synchronize
votes and resolve an absolute majority of round participants; ties, abstentions,
or insufficient consensus produce a stalemate. Human results leave the player in
the room. Human/stalemate banners display for three seconds before starting the
next local discussion, for up to three rounds. The host can reopen the lobby at
the end. A supplied AI result immediately calls the app's `onAiEliminated` handler
and opens the human-win screen. The local roster has no AI agent, so identifying
a real AI must come from the game engine. The modal supports all three result
states through `roundResult`. `?preview=vote` opens the standalone voting preview
without seeded opponents; use a multi-tab room to see real candidates.

`GameOverReveal` is a three-step, keyboard-accessible reveal: roster identities
and the most-suspicious-human award, supplied AI post-game notes, and a copyable
IRL conversation opener. All identity, vote-total, confession, and pairing data
comes from its props. Human wins trigger an owned canvas-confetti burst, skipped
for reduced motion; theme changes do not replay it. Missing names or missions
show explicit empty states. The local game does not yet collect real names or
produce confession/pairing data, so those must be supplied by the game engine.
Use `?preview=reveal&win=humans` for the human-win preview or
`?preview=reveal` for the AI-win preview. Neither seeds fake identity/game data.
