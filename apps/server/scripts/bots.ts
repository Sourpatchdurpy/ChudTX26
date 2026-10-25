// Fake human players for testing.
//   npm run bots -w @game/server -- --room ABCD --count 3 [--url http://localhost:4000] [--allow-muse]
// Bots join, then behave like sloppy humans: answer late, chat a bit, vote and
// vouch randomly. They never start the game: start it as host from a browser tab.
// Budget guard: refuses to run against an AI_MODE=muse server without --allow-muse.
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, Phase, PlayerId, RoomView, ServerToClientEvents } from "@game/shared";

type BotSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const room = arg("room")?.toUpperCase() ?? "";
const count = Math.min(6, Math.max(1, Number(arg("count") ?? 3)));
const url = (arg("url") ?? "http://localhost:4000").replace(/\/$/, "");
const allowMuse = process.argv.includes("--allow-muse");

if (!room) {
  console.error("usage: npm run bots -w @game/server -- --room ABCD --count 3 [--url http://localhost:4000] [--allow-muse]");
  process.exit(1);
}

const health = (await fetch(`${url}/health`)
  .then((r) => r.json())
  .catch((e: unknown) => {
    console.error(`Can't reach ${url}/health: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  })) as { ok: boolean; aiMode: string };
if (health.aiMode === "muse" && !allowMuse) {
  console.error(
    `${url} is running AI_MODE=muse: every bot game spends real Muse credits (~$0.10–0.20 per game).\n` +
      "Re-run with --allow-muse if you really mean it.",
  );
  process.exit(1);
}

const NAMES = ["Bot Ana", "Bot Ben", "Bot Cy", "Bot Dee", "Bot Eli", "Bot Fay"];
const ANSWERS = [
  "tacos obviously",
  "idk probably sleep lol",
  "ok this is hard. i'd say my grandma's kitchen growing up, it always smelled like cumin",
  "karaoke and its not close",
  "i once got lost in ikea for 2 hours",
  "brisket. next question",
];
const CHAT = ["lol", "wait who said that", "thats so real", "nah fox is sus", "ok owl answer was too perfect", "same tbh", "hmm"];
const PAIR = ["hi!", "ok what do we have in common", "wait same", "i'm from dallas, you?", "lmao ok that works"];
const COLLAB = ["we both hate mornings", "we both have a sibling named alex", "we both quit piano"];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

function startBot(name: string) {
  const socket: BotSocket = io(url, { transports: ["websocket"] });
  let token: string | null = null;
  let myId: PlayerId | null = null;
  let lastKey = "";
  let latest: RoomView | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const log = (msg: string) => console.log(`[${name}] ${msg}`);
  /** Runs fn after a random delay, unless the phase has moved on by then. */
  const later = (minMs: number, maxMs: number, phase: Phase, fn: (view: RoomView) => void) => {
    const view = latest;
    const left = view?.phaseEndsAt ? view.phaseEndsAt - view.serverNow - 1_000 : maxMs;
    const t = setTimeout(
      () => {
        timers.delete(t);
        if (latest?.phase === phase) fn(latest);
      },
      Math.max(0, Math.min(rand(minMs, maxMs), left)),
    );
    timers.add(t);
  };
  const warn = (what: string) => (res: { ok: boolean; error?: string }) => {
    if (!res.ok) log(`${what} rejected: ${res.error}`);
  };

  socket.on("connect", () => {
    if (token) {
      socket.emit("room:rejoin", { code: room, token }, (res) => (res.ok ? log("rejoined") : log(`rejoin failed: ${res.error}`)));
      return;
    }
    socket.emit("room:join", { code: room, realName: name }, (res) => {
      if (!res.ok) {
        log(`join failed: ${res.error}`);
        socket.close();
        return;
      }
      token = res.token;
      myId = res.playerId;
      log("joined");
    });
  });

  socket.on("room:closed", ({ reason }) => {
    log(`room closed: ${reason}`);
    for (const t of timers) clearTimeout(t);
    socket.close();
  });

  socket.on("room:state", (view) => {
    latest = view;
    const key = `${view.phase}:${view.round?.number ?? ""}`;
    if (key === lastKey || !myId) return;
    lastKey = key;
    const me = myId;
    const others = () => (latest?.players ?? []).map((p) => p.id).filter((id) => id !== me);

    switch (view.phase) {
      case "answer":
        later(3_000, 20_000, "answer", () => socket.emit("answer:submit", { text: pick(ANSWERS) }, warn("answer")));
        break;
      case "discuss": {
        const n = Math.floor(rand(0, 4));
        for (let i = 0; i < n; i++) later(2_000, 35_000, "discuss", () => socket.emit("chat:send", { text: pick(CHAT), channel: "group" }, warn("chat")));
        break;
      }
      case "vote":
      case "finalVote":
        later(1_000, 9_000, view.phase, () => {
          const targets = others();
          if (targets.length) socket.emit("vote:cast", { targetId: pick(targets) }, warn("vote"));
        });
        break;
      case "pairChat": {
        const n = 1 + Math.floor(rand(0, 3));
        for (let i = 0; i < n; i++) later(2_000, 60_000, "pairChat", () => socket.emit("chat:send", { text: pick(PAIR), channel: "pair" }, warn("pair chat")));
        later(20_000, 75_000, "pairChat", () => socket.emit("collab:submit", { text: pick(COLLAB) }, warn("collab")));
        break;
      }
      case "pairResults":
        later(2_000, 12_000, "pairResults", (v) => {
          const pair = v.pairs?.find((p) => p.members.includes(me));
          for (const id of pair?.members ?? []) {
            if (id !== me) socket.emit("vouch:set", { targetId: id, vouched: Math.random() < 0.6 }, warn("vouch"));
          }
        });
        break;
      case "reveal":
        log(`reveal: ${view.reveal?.humansWon ? "humans won" : "AI won"}`);
        break;
    }
  });
}

console.log(`Starting ${count} bots in room ${room} on ${url} (server AI_MODE=${health.aiMode})`);
for (let i = 0; i < count; i++) setTimeout(() => startBot(NAMES[i]!), i * 300);
