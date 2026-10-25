// All live rooms (in memory), room code generation, the socket → seat index and
// the TTL sweep.
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_TTL_MS, type PlayerId, type RoomCode } from "@game/shared";
import { Room, type RoomDeps } from "./Room.js";

/** Host-picked room codes: 4 letters or digits (the entry screen's generator). */
export const REQUESTED_CODE_PATTERN = /^[A-Z0-9]{4}$/;

export class RoomCodeTakenError extends Error {
  constructor() {
    super("That room code is already in use. Reroll the code and try again.");
  }
}

export interface SocketBinding {
  code: RoomCode;
  /** null = spectator. */
  playerId: PlayerId | null;
}

export class RoomRegistry {
  readonly rooms = new Map<RoomCode, Room>();
  private readonly sockets = new Map<string, SocketBinding>();

  constructor(private readonly deps: RoomDeps) {}

  /** `requested` = a host-picked code (already validated, upper case); throws if taken. */
  create(requested?: RoomCode): Room {
    let code: RoomCode;
    if (requested) {
      if (this.rooms.has(requested)) throw new RoomCodeTakenError();
      code = requested;
    } else {
      do {
        code = Array.from(
          { length: ROOM_CODE_LENGTH },
          () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)],
        ).join("");
      } while (this.rooms.has(code));
    }
    const room = new Room(code, this.deps);
    this.rooms.set(code, room);
    this.deps.log(`[${code}] created (${this.rooms.size} rooms)`);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  /** The room and seat a socket belongs to, if any. */
  lookup(socketId: string): { room: Room; playerId: PlayerId | null } | null {
    const b = this.sockets.get(socketId);
    const room = b ? this.rooms.get(b.code) : undefined;
    return b && room ? { room, playerId: b.playerId } : null;
  }

  /** Binds a socket to a seat (or as a spectator), detaching it from wherever it was before. */
  bind(socketId: string, room: Room, playerId: PlayerId | null): void {
    this.unbind(socketId);
    this.sockets.set(socketId, { code: room.code, playerId });
    if (playerId) room.attachSocket(playerId, socketId);
    else room.addSpectator(socketId);
  }

  unbind(socketId: string): void {
    const b = this.sockets.get(socketId);
    if (!b) return;
    this.sockets.delete(socketId);
    this.rooms.get(b.code)?.detachSocket(socketId);
  }

  delete(room: Room, reason: string): void {
    room.close(reason);
    this.rooms.delete(room.code);
    for (const [sid, b] of this.sockets) if (b.code === room.code) this.sockets.delete(sid);
  }

  /** Deletes rooms idle longer than ROOM_TTL_MS. Run every 60s. */
  sweep(now = Date.now()): void {
    for (const room of [...this.rooms.values()]) {
      if (now - room.lastActivityAt > ROOM_TTL_MS) this.delete(room, "Room expired after 30 minutes of inactivity.");
    }
  }

  closeAll(reason: string): void {
    for (const room of [...this.rooms.values()]) this.delete(room, reason);
  }
}
