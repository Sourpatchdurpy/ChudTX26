// Socket layer: an in-process Socket.IO server on a random port with the stub AI.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import type { ClientToServerEvents, RoomView, ServerToClientEvents } from "@game/shared";
import { loadContent } from "../game/content.js";
import { RoomRegistry } from "../game/rooms.js";
import * as stub from "../game/stubAi.js";
import { registerHandlers } from "./handlers.js";

type C = Socket<ServerToClientEvents, ClientToServerEvents>;
let url = "";
let io: Server<ClientToServerEvents, ServerToClientEvents>;
let registry: RoomRegistry;
const clients: C[] = [];

before(async () => {
  const http = createServer();
  io = new Server(http);
  registry = new RoomRegistry({
    ai: stub,
    content: loadContent(),
    log: () => {},
    transport: {
      state: (sid, view) => io.to(sid).emit("room:state", view),
      closed: (sid, reason) => io.to(sid).emit("room:closed", { reason }),
    },
  });
  registerHandlers(io, registry, () => {});
  await new Promise<void>((r) => http.listen(0, r));
  url = `http://localhost:${(http.address() as AddressInfo).port}`;
});

after(async () => {
  for (const c of clients) c.close();
  registry.closeAll("test over");
  await io.close();
});

function client(): Promise<C> {
  const c: C = connect(url, { transports: ["websocket"], forceNew: true });
  clients.push(c);
  return new Promise((r) => c.on("connect", () => r(c)));
}
const emit = <T>(c: C, event: string, ...args: unknown[]) =>
  new Promise<T>((r) => (c.emit as (...a: unknown[]) => void)(event, ...args, r));
const nextState = (c: C) => new Promise<RoomView>((r) => c.once("room:state", r));

describe("socket handlers", () => {
  test("create → join → lobby broadcast with sorted names; host flag only for the host", async () => {
    const host = await client();
    const created = await emit<any>(host, "room:create", { realName: "  Zoe " });
    assert.ok(created.ok);
    assert.match(created.code, /^[A-Z]{4}$/);
    const p2 = await client();
    const hostState = nextState(host);
    const joined = await emit<any>(p2, "room:join", { code: created.code.toLowerCase(), realName: "Adam" });
    assert.ok(joined.ok);
    const v = await hostState;
    assert.deepEqual(v.lobby?.realNames, ["Adam", "Zoe"]);
    assert.equal(v.me?.isHost, true);
    const p2View = await new Promise<RoomView>((r) => {
      p2.once("room:state", r);
      registry.get(created.code)!.broadcast();
    });
    assert.equal(p2View.me?.isHost, false);
    assert.equal(p2View.me?.realName, "Adam");
  });

  test("malformed payloads are acked with an error, never crash the server", async () => {
    const c = await client();
    for (const payload of [undefined, null, 42, "str", {}, { realName: 5 }, { realName: "x".repeat(5000) }]) {
      const r = await emit<any>(c, "room:create", payload);
      assert.equal(r.ok, false, JSON.stringify(payload)?.slice(0, 40));
    }
    assert.equal((await emit<any>(c, "chat:send", { text: "hi", channel: "shout" })).ok, false);
    // No ack callback at all: must not throw server-side.
    (c.emit as (...a: unknown[]) => void)("answer:submit", { text: "hi" });
    (c.emit as (...a: unknown[]) => void)("game:start");
    const health = await emit<any>(c, "room:watch", { code: "ZZZZ" });
    assert.deepEqual(health, { ok: false, error: "Room not found. It may have expired." });
  });

  test("in-game actions require a seat", async () => {
    const c = await client();
    for (const [event, payload] of [
      ["answer:submit", { text: "hi" }],
      ["vote:cast", { targetId: "x" }],
      ["chat:send", { text: "hi", channel: "group" }],
    ] as const) {
      const r = await emit<any>(c, event, payload);
      assert.equal(r.ok, false);
      assert.match(r.error, /not in a game/);
    }
    assert.equal((await emit<any>(c, "game:start")).ok, false);
  });

  test("rejoin: bad token rejected; good token restores the seat on a new socket", async () => {
    const host = await client();
    const created = await emit<any>(host, "room:create", { realName: "Host" });
    const fresh = await client();
    assert.equal((await emit<any>(fresh, "room:rejoin", { code: created.code, token: "nope" })).ok, false);
    assert.equal((await emit<any>(fresh, "room:rejoin", { code: "QQQQ", token: created.token })).ok, false);
    host.close();
    const state = nextState(fresh);
    const r = await emit<any>(fresh, "room:rejoin", { code: created.code, token: created.token });
    assert.deepEqual(r, { ok: true, playerId: created.playerId });
    const v = await state;
    assert.equal(v.me?.id, created.playerId);
    assert.equal(v.me?.isHost, true);
  });

  test("spectator gets me = null; full room and late joins are refused", async () => {
    const host = await client();
    const created = await emit<any>(host, "room:create", { realName: "H" });
    const screen = await client();
    const s = nextState(screen);
    assert.ok((await emit<any>(screen, "room:watch", { code: created.code })).ok);
    assert.equal((await s).me, null);
    for (let i = 0; i < 5; i++) assert.ok((await emit<any>(await client(), "room:join", { code: created.code, realName: `P${i}` })).ok);
    const full = await emit<any>(await client(), "room:join", { code: created.code, realName: "Seventh" });
    assert.deepEqual(full, { ok: false, error: "This room is full." });
    await new Promise((r) => setTimeout(r, 1_100)); // stub persona
    assert.ok((await emit<any>(host, "game:start")).ok);
    const late = await emit<any>(await client(), "room:join", { code: created.code, realName: "Late" });
    assert.equal(late.ok, false);
  });
});
