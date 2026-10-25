// Test helpers (used only by *.test.ts). A Room with a fake transport and a
// controllable fake AI. Phases are driven by hand with advance(), so tests are
// fast and deterministic; the real phase timers are long and never fire.
import type {
  AiActions,
  AiPlayer,
  AiPlayerInit,
  GameEvent,
  MatchmakerOutput,
  Persona,
  PlayerId,
  RoomView,
} from "@game/shared";
import { loadContent } from "./content.js";
import { advance } from "./phases.js";
import { Room, type AiImpl } from "./Room.js";
import { runMatchmaker as stubMatchmaker } from "./stubAi.js";
import { fallbackPersona } from "@game/ai";

export const TEST_PERSONA: Persona = fallbackPersona();

export const flush = () => new Promise<void>((r) => setImmediate(r));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface FakeAi {
  events: GameEvent[];
  lastView: RoomView | null;
  actions: AiActions | null;
  disposed: boolean;
  init: AiPlayerInit | null;
}

export interface TestRoomOptions {
  humans?: number;
  persona?: () => Promise<Persona>;
  matchmaker?: AiImpl["runMatchmaker"];
  /** Replace the AiPlayer (e.g. one that throws). Gets the fake AI's state for recording. */
  player?: (fake: FakeAi) => AiPlayer;
  createThrows?: boolean;
}

export function makeRoom(opts: TestRoomOptions = {}) {
  const sent = new Map<string, RoomView[]>();
  const closedSockets: { socketId: string; reason: string }[] = [];
  const logs: string[] = [];
  const fake: FakeAi = { events: [], lastView: null, actions: null, disposed: false, init: null };

  const ai: AiImpl = {
    prepareAiPersona: opts.persona ?? (async () => structuredClone(TEST_PERSONA)),
    fallbackPersona: () => structuredClone(TEST_PERSONA),
    runMatchmaker: opts.matchmaker ?? stubMatchmaker,
    createAiPlayer: (init) => {
      if (opts.createThrows) throw new Error("boom: createAiPlayer");
      fake.init = init;
      fake.actions = init.actions;
      if (opts.player) return opts.player(fake);
      return {
        onEvent(event, view) {
          fake.events.push(event);
          fake.lastView = view;
        },
        getRevealInfo: () => ({ persona: { name: fake.lastView?.me?.nickname ?? "", blurb: TEST_PERSONA.blurb }, notes: [{ round: 1, text: "note" }] }),
        dispose() {
          fake.disposed = true;
        },
      };
    },
  };

  const room = new Room("TEST", {
    ai,
    content: loadContent(),
    log: (l) => logs.push(l),
    transport: {
      state: (sid, view) => {
        if (!sent.has(sid)) sent.set(sid, []);
        sent.get(sid)!.push(view);
      },
      closed: (socketId, reason) => closedSockets.push({ socketId, reason }),
    },
  });

  const humans: { id: PlayerId; token: string; name: string; socket: string }[] = [];
  for (let i = 0; i < (opts.humans ?? 4); i++) {
    const name = `Human${i}`;
    const res = room.addHuman(name, i === 0);
    if (!res.ok) throw new Error(res.error);
    const socket = `sock${i}`;
    room.attachSocket(res.playerId, socket);
    humans.push({ id: res.playerId, token: res.token, name, socket });
  }

  /** Latest view a socket received. */
  const lastView = (socket: string) => sent.get(socket)?.at(-1) ?? null;
  const host = humans[0]!;
  const start = async () => {
    const r = await room.start(host.id);
    if (!r.ok) throw new Error(r.error);
    await flush();
  };
  /** Advance until `phase` (max 12 steps). */
  const advanceTo = async (phase: RoomView["phase"]) => {
    for (let i = 0; i < 12 && room.phase !== phase; i++) {
      await advance(room);
      await flush();
    }
    if (room.phase !== phase) throw new Error(`could not reach ${phase}, stuck in ${room.phase}`);
  };
  const others = (id: PlayerId) => room.seats.filter((s) => s.id !== id).map((s) => s.id);

  return { room, humans, host, fake, sent, closedSockets, logs, lastView, start, advanceTo, others };
}

export function validMatch(humanIds: PlayerId[]): MatchmakerOutput {
  const odd = humanIds.length % 2 === 1;
  const pairs: [PlayerId, PlayerId][] = [];
  const rest = odd ? humanIds.slice(0, -1) : humanIds;
  for (let i = 0; i < rest.length; i += 2) pairs.push([rest[i]!, rest[i + 1]!]);
  return {
    humanPairs: pairs,
    leftover: odd ? humanIds.at(-1)! : null,
    sharedThings: [],
    suggestionForLeftover: null,
  };
}
