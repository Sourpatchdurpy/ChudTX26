// Socket event handlers: validate (zod) → find the seat → Room method → ack → broadcast.
// Every event is acked, including errors, and nothing thrown here escapes.
import type { Server, Socket } from "socket.io";
import { z } from "zod";
import type { AckResult, ClientToServerEvents, PlayerId, ServerToClientEvents } from "@game/shared";
import { errMsg, type Room } from "../game/Room.js";
import type { RoomRegistry } from "../game/rooms.js";

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

// Shape checks only. Length/content rules live in Room so they apply to the AI too.
const code = z.string().max(16);
const text = z.string().max(2_000);
const id = z.string().max(64);
const S = {
  create: z.object({ realName: text, codename: z.string().max(32).optional() }),
  join: z.object({ code, realName: text, codename: z.string().max(32).optional() }),
  rejoin: z.object({ code, token: z.string().max(64) }),
  watch: z.object({ code }),
  answer: z.object({ text }),
  chat: z.object({ text, channel: z.enum(["group", "pair"]) }),
  vote: z.object({ targetId: id }),
  collab: z.object({ text }),
  vouch: z.object({ targetId: id, vouched: z.boolean() }),
};

const BAD_REQUEST = { ok: false as const, error: "Invalid request." };
const NO_ROOM = { ok: false as const, error: "Room not found. It may have expired." };
const NOT_SEATED = { ok: false as const, error: "You are not in a game. Rejoin the room first." };

/** Clients may forget the callback; never crash on that. */
function safeAck<T extends object>(ack: unknown): (res: AckResult<T>) => void {
  return typeof ack === "function" ? (res) => (ack as (r: AckResult<T>) => void)(res) : () => {};
}

export function registerHandlers(io: GameServer, registry: RoomRegistry, log: (line: string) => void): void {
  io.on("connection", (socket: GameSocket) => {
    /** Runs a handler; any exception is logged and acked as a server error. */
    const handle = async <T extends object>(event: string, rawAck: unknown, fn: (ack: (r: AckResult<T>) => void) => unknown) => {
      const ack = safeAck<T>(rawAck);
      try {
        await fn(ack);
      } catch (e) {
        log(`[socket] ${event} failed: ${errMsg(e)}`);
        ack({ ok: false, error: "Server error." });
      }
    };

    /** For in-game actions: resolves the caller's seat, runs the Room method, acks, broadcasts. */
    const seated = <T extends object>(
      event: string,
      rawAck: unknown,
      fn: (room: Room, playerId: PlayerId) => AckResult<T> | Promise<AckResult<T>> | null,
    ) =>
      handle<T>(event, rawAck, async (ack) => {
        const ctx = registry.lookup(socket.id);
        if (!ctx?.playerId) return ack(NOT_SEATED);
        const res = await fn(ctx.room, ctx.playerId);
        if (res === null) return ack(BAD_REQUEST);
        ack(res);
        if (res.ok) ctx.room.broadcast();
      });

    socket.on("room:create", (p, ack) =>
      handle<{ code: string; playerId: PlayerId; token: string }>("room:create", ack, (reply) => {
        const parsed = S.create.safeParse(p);
        if (!parsed.success) return reply(BAD_REQUEST);
        const room = registry.create();
        const res = room.addHuman(parsed.data.realName, true, parsed.data.codename);
        if (!res.ok) {
          registry.delete(room, "creation failed");
          return reply(res);
        }
        registry.bind(socket.id, room, res.playerId);
        reply({ ok: true, code: room.code, playerId: res.playerId, token: res.token });
        room.broadcast();
      }),
    );

    socket.on("room:join", (p, ack) =>
      handle<{ playerId: PlayerId; token: string }>("room:join", ack, (reply) => {
        const parsed = S.join.safeParse(p);
        if (!parsed.success) return reply(BAD_REQUEST);
        const room = registry.get(parsed.data.code);
        if (!room) return reply(NO_ROOM);
        const res = room.addHuman(parsed.data.realName, false, parsed.data.codename);
        if (!res.ok) return reply(res);
        registry.bind(socket.id, room, res.playerId);
        reply({ ok: true, playerId: res.playerId, token: res.token });
        room.broadcast();
      }),
    );

    socket.on("room:rejoin", (p, ack) =>
      handle<{ playerId: PlayerId }>("room:rejoin", ack, (reply) => {
        const parsed = S.rejoin.safeParse(p);
        if (!parsed.success) return reply(BAD_REQUEST);
        const room = registry.get(parsed.data.code);
        if (!room) return reply(NO_ROOM);
        const seat = room.seatByToken(parsed.data.token);
        if (!seat) return reply({ ok: false, error: "Your seat in this room was not found." });
        registry.bind(socket.id, room, seat.id);
        reply({ ok: true, playerId: seat.id });
        // Nothing visible to others changed (connection status is private).
        room.sendStateTo(socket.id, seat.id);
      }),
    );

    socket.on("room:watch", (p, ack) =>
      handle("room:watch", ack, (reply) => {
        const parsed = S.watch.safeParse(p);
        if (!parsed.success) return reply(BAD_REQUEST);
        const room = registry.get(parsed.data.code);
        if (!room) return reply(NO_ROOM);
        registry.bind(socket.id, room, null);
        reply({ ok: true });
        room.sendStateTo(socket.id, null);
      }),
    );

    socket.on("game:start", (ack) => seated("game:start", ack, (room, pid) => room.start(pid)));

    socket.on("answer:submit", (p, ack) =>
      seated("answer:submit", ack, (room, pid) => {
        const parsed = S.answer.safeParse(p);
        return parsed.success ? room.submitAnswer(pid, parsed.data.text) : null;
      }),
    );

    socket.on("chat:send", (p, ack) =>
      seated<{ messageId: string; visibleAt: number }>("chat:send", ack, (room, pid) => {
        const parsed = S.chat.safeParse(p);
        return parsed.success ? room.sendChat(pid, parsed.data.text, parsed.data.channel) : null;
      }),
    );

    socket.on("vote:cast", (p, ack) =>
      seated("vote:cast", ack, (room, pid) => {
        const parsed = S.vote.safeParse(p);
        return parsed.success ? room.castVote(pid, parsed.data.targetId) : null;
      }),
    );

    socket.on("collab:submit", (p, ack) =>
      seated("collab:submit", ack, (room, pid) => {
        const parsed = S.collab.safeParse(p);
        return parsed.success ? room.submitCollab(pid, parsed.data.text) : null;
      }),
    );

    socket.on("vouch:set", (p, ack) =>
      seated("vouch:set", ack, (room, pid) => {
        const parsed = S.vouch.safeParse(p);
        return parsed.success ? room.setVouch(pid, parsed.data.targetId, parsed.data.vouched) : null;
      }),
    );

    // hostAdvance/playAgain broadcast through enterPhase themselves; the extra
    // broadcast from seated() is harmless.
    socket.on("host:advance", (ack) => seated("host:advance", ack, (room, pid) => room.hostAdvance(pid)));
    socket.on("host:playAgain", (ack) => seated("host:playAgain", ack, (room, pid) => room.playAgain(pid)));

    socket.on("disconnect", () => registry.unbind(socket.id));
  });
}
