// ─────────────────────────────────────────────────────────────────────────────
// SHARED CONTRACT: Socket.IO events (typed). Owner: Part 3.
// Server:  new Server<ClientToServerEvents, ServerToClientEvents>(...)
// Client:  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(...)
//
// Every client→server event takes an ack callback. The server ALWAYS calls it,
// with { ok: true, ... } or { ok: false, error }. After any accepted action, the
// server broadcasts a fresh "room:state" to everyone in the room, so clients
// never patch state locally (except showing their own pending chat message).
// ─────────────────────────────────────────────────────────────────────────────

import type { Channel, PlayerId, RoomCode, RoomView } from "./types";

export type AckResult<T extends object = {}> = ({ ok: true } & T) | { ok: false; error: string };
export type Ack<T extends object = {}> = (res: AckResult<T>) => void;

export interface ClientToServerEvents {
  /** Creates a room; the creator becomes host and joins as a player. */
  "room:create": (p: { realName: string }, ack: Ack<{ code: RoomCode; playerId: PlayerId; token: string }>) => void;
  /** Join only while phase === "lobby". */
  "room:join": (p: { code: RoomCode; realName: string }, ack: Ack<{ playerId: PlayerId; token: string }>) => void;
  /** Reconnect after refresh/sleep. Client keeps {code, token} in sessionStorage. */
  "room:rejoin": (p: { code: RoomCode; token: string }, ack: Ack<{ playerId: PlayerId }>) => void;
  /** Big-screen spectator. Receives RoomView with me === null and group chat only. */
  "room:watch": (p: { code: RoomCode }, ack: Ack) => void;

  /** Host only, lobby only, needs >= LIMITS.minHumans humans. */
  "game:start": (ack: Ack) => void;
  /** "answer" phase only. Can be resubmitted until the phase ends (last one wins). */
  "answer:submit": (p: { text: string }, ack: Ack) => void;
  /** group: "discuss" phase. pair: "pairChat" phase. Message becomes visible after CHAT_DELAY_MS. */
  "chat:send": (p: { text: string; channel: Channel }, ack: Ack<{ messageId: string; visibleAt: number }>) => void;
  /** "vote" or "finalVote". Can't vote for yourself. Changing your vote is allowed until the phase ends. */
  "vote:cast": (p: { targetId: PlayerId }, ack: Ack) => void;
  /** "pairChat" phase. Resubmittable until the phase ends. */
  "collab:submit": (p: { text: string }, ack: Ack) => void;
  /** "pairResults" phase. Target must be in your pair. */
  "vouch:set": (p: { targetId: PlayerId; vouched: boolean }, ack: Ack) => void;

  /** Host only: end the current timed phase now / move reveal → partners. Used for demos. */
  "host:advance": (ack: Ack) => void;
  /** Host only, after the game: back to lobby with the same humans, fresh nicknames, new AI. */
  "host:playAgain": (ack: Ack) => void;
}

export interface ServerToClientEvents {
  /** Full per-viewer snapshot. Sent on every change and right after join/rejoin/watch. */
  "room:state": (view: RoomView) => void;
  /** Room deleted (expired or server restart). Client returns to home screen. */
  "room:closed": (p: { reason: string }) => void;
}
