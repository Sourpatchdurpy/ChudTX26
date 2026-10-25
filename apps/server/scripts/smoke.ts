// End-to-end smoke test over real sockets against a running server (stub AI only).
//   TIMER_SCALE=0.3 npm run dev -w @game/server      (in another terminal)
//   npm run smoke -w @game/server -- [--url http://localhost:4000] [--rooms 2] [--humans 3]
// Each room: a host + bots play a full game, the host advances reveal → partners
// and plays again. Checks immediate chat, cooldown, rejoin, spectator view and acks.
import { io, type Socket } from "socket.io-client";
import { type ClientToServerEvents, type RoomView, type ServerToClientEvents } from "@game/shared";

type S = Socket<ServerToClientEvents, ClientToServerEvents>;
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const url = arg("url") ?? "http://localhost:4000";
const roomsN = Number(arg("rooms") ?? 1);
const humansN = Math.max(3, Number(arg("humans") ?? 3));

const health = (await (await fetch(`${url}/health`)).json()) as { aiMode: string };
if (health.aiMode !== "stub") {
  console.error(`smoke test only runs against AI_MODE=stub (server says ${health.aiMode})`);
  process.exit(1);
}

const connect = () => io(url, { transports: ["websocket"], forceNew: true }) as S;
const call = <T>(fn: (cb: (r: T) => void) => void) => new Promise<T>((resolve) => fn(resolve));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function playRoom(tag: string): Promise<string[]> {
  const problems: string[] = [];
  const views: RoomView[] = [];
  const host = connect();
  host.on("room:state", (v) => views.push(v));
  const created = await call<any>((cb) => host.emit("room:create", { realName: `Host${tag}` }, cb));
  if (!created.ok) return [`create failed: ${created.error}`];
  const code: string = created.code;

  const screen = connect();
  let screenView: RoomView | null = null;
  screen.on("room:state", (v) => (screenView = v));
  await call<any>((cb) => screen.emit("room:watch", { code }, cb));

  // Humans: the host plus bots that answer/chat/vote/vouch on every phase.
  const players: { s: S; id: string; token: string; last: RoomView | null }[] = [];
  players.push({ s: host, id: created.playerId, token: created.token, last: null });
  for (let i = 1; i < humansN; i++) {
    const s = connect();
    const r = await call<any>((cb) => s.emit("room:join", { code, realName: `P${tag}${i}` }, cb));
    if (!r.ok) return [`join failed: ${r.error}`];
    players.push({ s, id: r.playerId, token: r.token, last: null });
  }
  let chatChecked = false;
  let clockOffset = 0;
  for (const p of players) {
    let lastKey = "";
    p.s.on("room:state", (v) => {
      p.last = v;
      // Server clock minus ours (the VM's clock can differ from the laptop's).
      clockOffset = v.serverNow - Date.now();
      const key = `${v.phase}:${v.round?.number}`;
      if (key === lastKey) return;
      lastKey = key;
      const others = v.players.filter((x) => x.id !== p.id).map((x) => x.id);
      setTimeout(async () => {
        if (v.phase === "answer") p.s.emit("answer:submit", { text: `answer ${p.id.slice(0, 4)}` }, () => {});
        if (v.phase === "discuss") {
          const serverNow = () => Date.now() + clockOffset;
          const sentAt = serverNow();
          const r = await call<any>((cb) => p.s.emit("chat:send", { text: `hi from ${p.id.slice(0, 4)}`, channel: "group" }, cb));
          if (!r.ok) problems.push(`chat rejected: ${r.error}`);
          else if (!chatChecked) {
            chatChecked = true;
            if (Math.abs(r.visibleAt - sentAt) > 300) problems.push("chat was held instead of sent immediately");
            const repeat = await call<any>((cb) => p.s.emit("chat:send", { text: "too soon", channel: "group" }, cb));
            if (repeat.ok) problems.push("chat cooldown did not block a second message");
            await wait(200);
            if (!players.every(q => q.last?.messages.some(m => m.id === r.messageId))) problems.push("chat not immediately visible to everyone");
          }
        }
        if (v.phase === "vote" || v.phase === "finalVote") p.s.emit("vote:cast", { targetId: others[0]! }, () => {});
        if (v.phase === "pairChat") {
          p.s.emit("chat:send", { text: "pair hi", channel: "pair" }, () => {});
          p.s.emit("collab:submit", { text: "we both like naps" }, () => {});
        }
        if (v.phase === "pairResults") {
          for (const id of v.pairs?.find((x) => x.members.includes(p.id))?.members ?? []) {
            if (id !== p.id) p.s.emit("vouch:set", { targetId: id, vouched: true }, () => {});
          }
        }
      }, 200);
    });
  }

  await wait(1_300); // persona prep (~1s in stub mode)
  const nonHostStart = await call<any>((cb) => players[1]!.s.emit("game:start", cb));
  if (nonHostStart.ok) problems.push("non-host could start the game");
  const started = await call<any>((cb) => host.emit("game:start", cb));
  if (!started.ok) return [...problems, `start failed: ${started.error}`];
  const afterStart = await call<any>((cb) => connect().emit("room:join", { code, realName: "TooLate" }, cb));
  if (afterStart.ok) problems.push("join after start was accepted");

  // Refresh a player mid-game: a new socket rejoins with the token.
  await wait(2_000);
  const victim = players[1]!;
  const beforePhase = victim.last?.phase;
  victim.s.close();
  const s2 = connect();
  const rj = await call<any>((cb) => s2.emit("room:rejoin", { code, token: victim.token }, cb));
  if (!rj.ok || rj.playerId !== victim.id) problems.push(`rejoin failed: ${JSON.stringify(rj)}`);
  const rejoinView = await new Promise<RoomView>((resolve) => s2.once("room:state", resolve));
  if (rejoinView.me?.id !== victim.id) problems.push("rejoin view has the wrong me");
  if (beforePhase && rejoinView.phase !== beforePhase && rejoinView.phase === "lobby") problems.push("rejoin lost the phase");
  victim.s = s2;
  s2.on("room:state", (v) => (victim.last = v));

  // A full game at real speed is ~5 min (TIMER_SCALE=1); allow headroom.
  const deadline = Date.now() + 10 * 60_000;
  while (host.connected && views[views.length - 1]?.phase !== "reveal") {
    if (Date.now() > deadline) return [...problems, `stuck in ${views[views.length - 1]?.phase}`];
    await wait(200);
  }
  const reveal = views[views.length - 1]!.reveal;
  if (!reveal) problems.push("no reveal payload");
  if (reveal && Object.keys(reveal.realNames).length !== humansN) problems.push("reveal realNames count wrong");
  const sv = screenView as RoomView | null;
  if (!sv || sv.me !== null || sv.messages.some((m) => m.channel === "pair")) problems.push("spectator view wrong");

  await call<any>((cb) => host.emit("host:advance", cb));
  await wait(300);
  const partnersView = views[views.length - 1]!;
  if (partnersView.phase !== "partners" || !partnersView.me?.partnerCard) problems.push("no partner card for host");
  const again = await call<any>((cb) => host.emit("host:playAgain", cb));
  if (!again.ok) problems.push(`playAgain failed: ${again.error}`);
  await wait(300);
  const lobby = views[views.length - 1]!;
  if (lobby.phase !== "lobby" || lobby.lobby?.realNames.length !== humansN) problems.push("play again lobby wrong");

  console.log(`[${code}] ${reveal?.humansWon ? "humans" : "AI"} won · ${problems.length} problems`);
  for (const p of players) p.s.close();
  screen.close();
  return problems;
}

const results = await Promise.all(Array.from({ length: roomsN }, (_, i) => playRoom(String.fromCharCode(65 + i))));
const all = results.flat();
if (all.length) {
  console.error(`SMOKE FAILED:\n  ${all.join("\n  ")}`);
  process.exit(1);
}
console.log(`smoke passed: ${roomsN} room(s), ${humansN} humans each`);
process.exit(0);
