// Privacy self-check: `npm run check:privacy -w @game/server`
// Plays a full stub game (4 humans + stub AI, fast timers, no sockets, no Muse),
// captures every RoomView the server would send (players, spectator, AI) and
// asserts nothing leaks before "reveal". Exits 1 on any violation.
export {};
process.env.TIMER_SCALE = "0.05";
process.env.CHAT_DELAY_MS = "100";

const { loadContent } = await import("../src/game/content.js");
const { Room } = await import("../src/game/Room.js");
const { buildView } = await import("../src/game/view.js");
const stub = await import("../src/game/stubAi.js");
type RoomView = import("@game/shared").RoomView;
type Phase = import("@game/shared").Phase;

const NAMES = ["Xanthippe", "Quillon", "Brontae", "Zephyrine"];
const failures: string[] = [];
const phasesSeen = new Set<Phase>();
let viewsChecked = 0;

const room = new Room("TEST", {
  ai: stub,
  content: loadContent(),
  log: () => {},
  transport: { state: (sid, view) => onView(sid, view), closed: () => {} },
});

const humans = NAMES.map((name, i) => {
  const res = room.addHuman(name, i === 0);
  if (!res.ok) throw new Error(res.error);
  room.attachSocket(res.playerId, `sock-${name}`);
  return { name, id: res.playerId, token: res.token, socket: `sock-${name}` };
});
const host = humans[0]!;
room.addSpectator("sock-screen");
const viewerBySocket = new Map<string, string | null>([...humans.map((h) => [h.socket, h.id] as const), ["sock-screen", null]]);

/** Every place a player id is allowed to appear in a pre-reveal view (for humans and the AI alike). */
const PLAYER_ID_PATHS = new Set([
  ".players[].id",
  ".messages[].from",
  ".history[].answers[].playerId",
  ".history[].voteCounts.{key}",
  ".lastVoteCounts.{key}",
  ".pairs[].members[]",
  ".collabResults.{key}",
  ".vouches[].from",
  ".vouches[].target",
  ".me.myVote",
  ".me.myVouches.{key}",
]);

function fail(msg: string) {
  if (failures.length < 50) failures.push(msg);
}

/** Every path where a value equal to `id` appears, with array indices and record keys normalized. */
function idPaths(value: unknown, id: string, path = "", out = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (value === id) out.add(path);
  } else if (Array.isArray(value)) {
    value.forEach((v) => idPaths(v, id, `${path}[]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const key = k === id ? "{id}" : room.seat(k) ? "{other}" : k;
      if (k === id) out.add(`${path}.{key}`);
      idPaths(v, id, `${path}.${key}`, out);
    }
  }
  return out;
}

function checkView(label: string, view: RoomView, viewerId: string | null) {
  viewsChecked++;
  phasesSeen.add(view.phase);
  const json = JSON.stringify(view);
  const preReveal = view.phase !== "reveal" && view.phase !== "partners";
  const aiId = room.aiId;
  const viewer = humans.find((h) => h.id === viewerId);

  for (const h of humans) if (json.includes(h.token)) fail(`${label}: contains a seat token`);
  for (const k of ["isAi", "token", "socketIds", "connected", "aiPlayerId\""]) {
    if (preReveal && json.includes(`"${k}`)) fail(`${label}: contains key ${k}`);
  }
  if (!preReveal) return;

  if (view.reveal !== null) fail(`${label}: reveal before reveal phase`);
  if (view.me && view.me.isHost && viewerId !== host.id) fail(`${label}: isHost true for non-host`);
  if ((json.match(/"isHost"/g) ?? []).length > (view.me ? 1 : 0)) fail(`${label}: isHost outside me`);
  if ((json.match(/"realName"/g) ?? []).length > (view.me ? 1 : 0)) fail(`${label}: realName outside me`);

  // Real names: only your own, plus the lobby list while in the lobby.
  if (view.phase !== "lobby") {
    for (const h of humans) if (h.id !== viewerId && json.includes(h.name)) fail(`${label}: leaks real name ${h.name}`);
    // Personas have no name; the blurb is the identifying detail that must stay hidden until reveal.
    if (aiId && viewerId !== aiId && json.includes(stub.STUB_PERSONA.blurb)) fail(`${label}: leaks AI persona blurb`);
  }

  // The AI's id may appear only where any player's id can appear.
  if (aiId && viewerId !== aiId) {
    for (const p of idPaths(view, aiId)) {
      if (!PLAYER_ID_PATHS.has(p)) fail(`${label}: AI id at unexpected path ${p}`);
    }
  }

  // Current round answers are hidden until discuss.
  if (view.phase === "answer") {
    const cur = view.history[view.history.length - 1];
    if (cur && cur.answers.length > 0) fail(`${label}: answers visible during answer phase`);
    for (const [pid, text] of room.answers) {
      if (pid !== viewerId && json.includes(JSON.stringify(text))) fail(`${label}: someone else's answer visible during answer`);
    }
  }

  // Pair chat stays in the pair; spectators see group only.
  const myPairId = viewerId ? room.pairOf(viewerId)?.id : undefined;
  for (const m of view.messages) {
    if (m.channel === "pair" && m.pairId !== myPairId) fail(`${label}: sees another pair's message`);
  }
  if (viewerId === null && view.me !== null) fail(`${label}: spectator has me`);
  if (viewer && view.me?.realName !== viewer.name) fail(`${label}: wrong me.realName`);
}

function onView(socketId: string, view: RoomView) {
  const viewerId = viewerBySocket.get(socketId) ?? null;
  checkView(`${view.phase} → ${viewerId ? humans.find((h) => h.id === viewerId)?.name : "screen"}`, view, viewerId);
  // The AI virtual client gets the same treatment (it must not see real names either).
  if (room.aiId) checkView(`${view.phase} → AI`, buildView(room, room.aiId), room.aiId);
  act(view, viewerId);
}

// Simulated humans: act once per phase on the first view they get.
const acted = new Set<string>();
function act(view: RoomView, viewerId: string | null) {
  if (!viewerId) return;
  const key = `${viewerId}:${view.phase}:${view.round?.number}`;
  if (acted.has(key)) return;
  acted.add(key);
  const others = view.players.filter((p) => p.id !== viewerId).map((p) => p.id);
  const partners = view.pairs?.find((p) => p.members.includes(viewerId))?.members.filter((id) => id !== viewerId) ?? [];
  const h = humans.find((x) => x.id === viewerId)!;
  setTimeout(() => {
    const ok = (r: { ok: boolean }) => r.ok && room.broadcast();
    switch (view.phase) {
      case "answer":
        ok(room.submitAnswer(viewerId, `secret answer from ${h.name.slice(0, 3)} r${view.round?.number}`));
        break;
      case "discuss":
        ok(room.sendChat(viewerId, "group hello", "group"));
        break;
      case "vote":
      case "finalVote":
        ok(room.castVote(viewerId, others[0]!));
        break;
      case "pairChat":
        ok(room.sendChat(viewerId, `pair hello ${view.me?.myPairId}`, "pair"));
        ok(room.submitCollab(viewerId, "we both like tacos"));
        break;
      case "pairResults":
        for (const p of partners) ok(room.setVouch(viewerId, p, true));
        break;
    }
  }, 30);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(phase: Phase, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (room.phase !== phase) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${phase} (stuck in ${room.phase})`);
    await wait(20);
  }
}

room.broadcast();
await wait(1_200); // stub persona resolves after ~1s
const start = await room.start(host.id);
if (!start.ok) throw new Error(start.error);
await waitFor("reveal", 30_000);

const reveal = room.reveal;
if (!reveal || reveal.aiPlayerId !== room.aiId) fail("reveal: missing or wrong aiPlayerId");
for (const h of humans) if (reveal?.realNames[h.id] !== h.name) fail(`reveal: missing real name for ${h.name}`);
if (reveal && Object.keys(reveal.realNames).includes(room.aiId!)) fail("reveal: realNames includes the AI");

room.hostAdvance(host.id);
await waitFor("partners", 2_000);
for (const h of humans) if (!room.partnerCards.get(h.id)) fail(`partners: no card for ${h.name}`);
const playAgain = room.playAgain(host.id);
if (!playAgain.ok) fail(`playAgain: ${playAgain.error}`);
if (room.phase !== "lobby" || room.seats.some((s) => s.isAi) || room.seats.length !== humans.length) fail("playAgain: bad lobby state");
room.close("done");

const expected: Phase[] = ["lobby", "answer", "discuss", "vote", "voteResult", "pairChat", "pairResults", "finalVote", "reveal", "partners"];
for (const p of expected) if (!phasesSeen.has(p)) fail(`phase never observed: ${p}`);

if (failures.length > 0) {
  console.error(`PRIVACY CHECK FAILED (${failures.length} problems):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`privacy check passed: ${viewsChecked} views across ${phasesSeen.size} phases, humans won: ${reveal?.humansWon}`);
process.exit(0);
