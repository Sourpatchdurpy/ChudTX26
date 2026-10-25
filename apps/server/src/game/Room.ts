// One game room, entirely in memory. Action methods (submitAnswer, sendChat, …)
// are shared by socket handlers and the AI's AiActions, so every rule applies
// to both. They validate and mutate but do NOT broadcast: the caller acks, then
// calls broadcast(), per the handler flow in PART_3 §4.
import { nanoid } from "nanoid";
import {
  LIMITS,
  NICKNAMES,
  type AckResult,
  type AiActions,
  type AiPlayer,
  type Channel,
  type ChatMessage,
  type CreateAiPlayer,
  type CurrentRound,
  type GameEvent,
  type MatchmakerOutput,
  type Pair,
  type PartnerCard,
  type Persona,
  type PlayerId,
  type PrepareAiPersona,
  type RevealPayload,
  type RoomCode,
  type RoomView,
  type RoundNumber,
  type RoundRecord,
  type RunMatchmaker,
  type Vouch,
} from "@game/shared";
import { ALL_ANSWERED_GRACE_MS, ALL_VOTED_GRACE_MS, chatDelayMs, PERSONA_WAIT_MS } from "./config.js";
import type { ContentStore } from "./content.js";
import { advance, beginRound, enterPhase } from "./phases.js";
import { shuffle, withTimeout } from "./random.js";
import { fallbackPersona as emergencyFallbackPersona, validatePersona } from "@game/ai";
import { buildView } from "./view.js";

export interface Seat {
  id: PlayerId;
  token: string;
  realName: string;
  isAi: boolean;
  isHost: boolean;
  nickname?: string;
  emoji?: string;
  socketIds: Set<string>;
  connected: boolean;
}

/** The names exported by both src/ai/index.ts and game/stubAi.ts. */
export interface AiImpl {
  createAiPlayer: CreateAiPlayer;
  prepareAiPersona: PrepareAiPersona;
  runMatchmaker: RunMatchmaker;
  /** Synchronous persona used when preparation misses the readiness deadline (PART_2_DESIGN §3.3). */
  fallbackPersona?: () => Persona;
}

/** How a room talks to sockets. Injected so tests can run without Socket.IO. */
export interface Transport {
  state(socketId: string, view: RoomView): void;
  closed(socketId: string, reason: string): void;
}

export interface RoomDeps {
  ai: AiImpl;
  content: ContentStore;
  transport: Transport;
  log: (line: string) => void;
}

type Ok<T extends object = {}> = AckResult<T>;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export class Room {
  // Seats are in join order in the lobby and in shuffled order after start.
  seats: Seat[] = [];
  spectators = new Set<string>();

  phase: RoomView["phase"] = "lobby";
  phaseEndsAt: number | null = null;
  timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every phase entry so stale timer callbacks do nothing. */
  phaseSeq = 0;
  /** True while game start or the round 3 setup awaits the AI; blocks re-entry. */
  busy = false;
  closed = false;

  roundNumber: RoundNumber | null = null;
  rounds: RoundRecord[] = [];
  currentRound: CurrentRound | null = null;
  answers = new Map<PlayerId, string>();

  /** Released messages only. */
  messages: ChatMessage[] = [];
  pending = new Map<string, { message: ChatMessage; timer: ReturnType<typeof setTimeout> }>();

  votes = new Map<PlayerId, PlayerId>();
  /** Round → voter → target. Round 3 = the final vote. */
  voteHistory = new Map<RoundNumber, Map<PlayerId, PlayerId>>();

  pairs: Pair[] = [];
  collabDraft = new Map<PlayerId, string>();
  collabResults: Record<PlayerId, string | null> | null = null;
  vouchDraft = new Map<PlayerId, Map<PlayerId, boolean>>();
  vouches: Vouch[] | null = null;
  reveal: RevealPayload | null = null;
  partnerCards = new Map<PlayerId, PartnerCard>();

  ai: AiPlayer | null = null;
  aiId: PlayerId | null = null;
  /** New for every game (Play Again included), so a late AI result can't touch the next game. */
  sessionGeneration = "";
  personaPromise: Promise<Persona> | null = null;
  personaAbort: AbortController | null = null;
  matchmakerPromise: Promise<MatchmakerOutput | null> | null = null;
  matchmakerOutput: MatchmakerOutput | null = null;

  usedPromptIds = new Set<string>();
  lastActivityAt = Date.now();

  private aiQueue: GameEvent[] = [];
  private aiDrainScheduled = false;
  private firstQuestionRevision = -1;

  constructor(
    readonly code: RoomCode,
    readonly deps: RoomDeps,
  ) {
    this.preparePersona();
  }

  // ── lookups ────────────────────────────────────────────────────────────────

  seat(id: PlayerId): Seat | undefined {
    return this.seats.find((s) => s.id === id);
  }
  humans(): Seat[] {
    return this.seats.filter((s) => !s.isAi);
  }
  pairOf(id: PlayerId): Pair | undefined {
    return this.pairs.find((p) => p.members.includes(id));
  }
  currentRecord(): RoundRecord | undefined {
    return this.rounds[this.rounds.length - 1];
  }
  touch(): void {
    this.lastActivityAt = Date.now();
  }
  log(msg: string): void {
    this.deps.log(`[${this.code}] ${msg}`);
  }

  // ── lobby / connections ────────────────────────────────────────────────────

  addHuman(rawName: string, isHost: boolean): Ok<{ playerId: PlayerId; token: string }> {
    const realName = rawName.trim();
    if (realName.length < 1) return fail("Enter your first name.");
    if (realName.length > LIMITS.realNameMaxChars) return fail(`Name must be at most ${LIMITS.realNameMaxChars} characters.`);
    if (this.phase !== "lobby" || this.busy) return fail("This game has already started.");
    if (this.humans().length >= LIMITS.maxHumans) return fail("This room is full.");
    const seat: Seat = {
      id: nanoid(10),
      token: nanoid(21),
      realName,
      isAi: false,
      isHost,
      socketIds: new Set(),
      connected: false,
    };
    this.seats.push(seat);
    this.touch();
    return { ok: true, playerId: seat.id, token: seat.token };
  }

  seatByToken(token: string): Seat | undefined {
    return this.seats.find((s) => !s.isAi && s.token === token);
  }

  attachSocket(seatId: PlayerId, socketId: string): void {
    const seat = this.seat(seatId);
    if (!seat) return;
    seat.socketIds.add(socketId);
    seat.connected = true;
    this.touch();
  }

  detachSocket(socketId: string): void {
    this.spectators.delete(socketId);
    for (const seat of this.seats) {
      if (seat.socketIds.delete(socketId)) seat.connected = seat.socketIds.size > 0;
    }
  }

  addSpectator(socketId: string): void {
    this.spectators.add(socketId);
    this.touch();
  }

  // ── game start ─────────────────────────────────────────────────────────────

  private preparePersona(): void {
    this.personaAbort?.abort();
    const abort = new AbortController();
    this.personaAbort = abort;
    try {
      this.personaPromise = this.deps.ai.prepareAiPersona({ roomCode: this.code, signal: abort.signal });
      // Avoid an unhandled rejection if nobody ever awaits it (room never starts).
      this.personaPromise.catch(() => {});
    } catch (e) {
      this.log(`prepareAiPersona threw: ${errMsg(e)}`);
      this.personaPromise = null;
    }
  }

  async start(byId: PlayerId): Promise<Ok> {
    const seat = this.seat(byId);
    if (!seat?.isHost) return fail("Only the host can start the game.");
    if (this.phase !== "lobby") return fail("The game has already started.");
    if (this.busy) return fail("The game is already starting.");
    if (this.humans().length < LIMITS.minHumans) return fail(`Need at least ${LIMITS.minHumans} players to start.`);

    this.busy = true;
    let persona: Persona | null = null;
    try {
      if (this.personaPromise) persona = validatePersona(await withTimeout(this.personaPromise, PERSONA_WAIT_MS, "persona"));
    } catch (e) {
      this.log(`persona not ready, using the fallback persona (${errMsg(e)})`);
    } finally {
      this.busy = false;
    }
    if (this.closed) return fail("Room closed.");
    if (this.phase !== "lobby") return fail("The game has already started.");
    if (!persona) {
      // Readiness deadline: freeze the fallback and stop preparing; a late result is ignored.
      this.personaAbort?.abort();
      try {
        persona = validatePersona(this.deps.ai.fallbackPersona?.() ?? emergencyFallbackPersona());
      } catch (e) {
        this.log(`fallbackPersona failed validation, using the complete fallback pool: ${errMsg(e)}`);
        persona = emergencyFallbackPersona();
      }
    }

    const aiSeat: Seat = {
      id: nanoid(10),
      token: nanoid(21),
      // Personas have no name: the AI is known only by its nickname, and the reveal uses that.
      realName: "",
      isAi: true,
      isHost: false,
      socketIds: new Set(),
      connected: true,
    };
    this.seats.push(aiSeat);
    this.aiId = aiSeat.id;
    const names = shuffle(NICKNAMES);
    this.seats.forEach((s, i) => {
      s.nickname = names[i]!.nickname;
      s.emoji = names[i]!.emoji;
    });
    this.seats = shuffle(this.seats);
    this.sessionGeneration = nanoid(12);
    this.firstQuestionRevision = -1;

    try {
      this.ai = this.deps.ai.createAiPlayer({
        sessionGeneration: this.sessionGeneration,
        roomCode: this.code,
        aiPlayerId: aiSeat.id,
        persona,
        actions: this.aiActions(aiSeat.id),
      });
      this.queueAiEvent({ type: "gameStarted" });
    } catch (e) {
      // The seat stays: the game runs on with a silent AI rather than stalling.
      this.log(`createAiPlayer threw, AI seat will be idle: ${errMsg(e)}`);
      this.ai = null;
    }

    beginRound(this, 1);
    enterPhase(this, "answer");
    this.publishFirstQuestionAnswers();
    return { ok: true };
  }

  // ── player actions (humans via sockets, AI via AiActions) ───────────────────

  submitAnswer(id: PlayerId, rawText: string): Ok {
    if (!this.seat(id)) return fail("You are not in this room.");
    if (this.phase !== "answer") return fail("Answers are closed.");
    const text = rawText.trim();
    if (!text) return fail("Answer is empty.");
    if (text.length > LIMITS.answerMaxChars) return fail(`Answer must be at most ${LIMITS.answerMaxChars} characters.`);
    this.answers.set(id, text);
    this.touch();
    if (!this.seat(id)!.isAi) this.publishFirstQuestionAnswers();
    if (this.answers.size >= this.seats.length) this.shortenPhase(ALL_ANSWERED_GRACE_MS);
    return { ok: true };
  }

  sendChat(id: PlayerId, rawText: string, channel: Channel): Ok<{ messageId: string; visibleAt: number }> {
    if (!this.seat(id)) return fail("You are not in this room.");
    let pairId: string | null = null;
    if (channel === "group") {
      if (this.phase !== "discuss") return fail("Group chat is closed.");
    } else {
      if (this.phase !== "pairChat") return fail("Pair chat is closed.");
      const pair = this.pairOf(id);
      if (!pair) return fail("You don't have a partner.");
      pairId = pair.id;
    }
    const text = rawText.trim();
    if (!text) return fail("Message is empty.");
    if (text.length > LIMITS.chatMaxChars) return fail(`Message must be at most ${LIMITS.chatMaxChars} characters.`);

    const visibleAt = Date.now() + chatDelayMs();
    const message: ChatMessage = { id: nanoid(12), channel, pairId, from: id, text, at: visibleAt };
    const timer = setTimeout(() => this.releaseMessage(message.id), visibleAt - Date.now());
    this.pending.set(message.id, { message, timer });
    this.touch();
    return { ok: true, messageId: message.id, visibleAt };
  }

  /** Released even if the phase has changed since it was sent. */
  private releaseMessage(messageId: string): void {
    try {
      const entry = this.pending.get(messageId);
      if (!entry || this.closed) return;
      this.pending.delete(messageId);
      const { message } = entry;
      this.messages.push(message);
      if (message.channel === "group") {
        this.broadcast({ type: "messageVisible", message });
      } else {
        // Pair messages only go to that pair (and never to spectators).
        const members = this.pairs.find((p) => p.id === message.pairId)?.members ?? [];
        this.emitToSeats(members);
        if (this.aiId && members.includes(this.aiId)) this.queueAiEvent({ type: "messageVisible", message });
      }
    } catch (e) {
      this.log(`releaseMessage failed: ${errMsg(e)}`);
    }
  }

  castVote(id: PlayerId, targetId: PlayerId): Ok {
    if (!this.seat(id)) return fail("You are not in this room.");
    if (this.phase !== "vote" && this.phase !== "finalVote") return fail("Voting is closed.");
    if (targetId === id) return fail("You can't vote for yourself.");
    if (!this.seat(targetId)) return fail("Unknown player.");
    this.votes.set(id, targetId);
    this.touch();
    if (this.votes.size >= this.seats.length) this.shortenPhase(ALL_VOTED_GRACE_MS);
    return { ok: true };
  }

  submitCollab(id: PlayerId, rawText: string): Ok {
    if (!this.seat(id)) return fail("You are not in this room.");
    if (this.phase !== "pairChat") return fail("Submissions are closed.");
    if (!this.pairOf(id)) return fail("You don't have a partner.");
    const text = rawText.trim();
    if (!text) return fail("Result is empty.");
    if (text.length > LIMITS.collabMaxChars) return fail(`Result must be at most ${LIMITS.collabMaxChars} characters.`);
    this.collabDraft.set(id, text);
    this.touch();
    return { ok: true };
  }

  setVouch(id: PlayerId, targetId: PlayerId, vouched: boolean): Ok {
    if (!this.seat(id)) return fail("You are not in this room.");
    if (this.phase !== "pairResults") return fail("Vouching is closed.");
    const pair = this.pairOf(id);
    if (!pair || targetId === id || !pair.members.includes(targetId)) return fail("You can only vouch for your partner.");
    let mine = this.vouchDraft.get(id);
    if (!mine) this.vouchDraft.set(id, (mine = new Map()));
    mine.set(targetId, vouched);
    this.touch();
    return { ok: true };
  }

  // ── host controls ──────────────────────────────────────────────────────────

  hostAdvance(id: PlayerId): Ok {
    if (!this.seat(id)?.isHost) return fail("Only the host can do that.");
    if (this.phase === "lobby") return fail("Start the game first.");
    if (this.phase === "partners") return fail("The game is over. Use play again.");
    if (this.busy) return fail("Hang on, setting up the next round.");
    this.touch();
    void this.safeAdvance();
    return { ok: true };
  }

  playAgain(id: PlayerId): Ok {
    if (!this.seat(id)?.isHost) return fail("Only the host can do that.");
    if (this.phase !== "partners") return fail("You can play again once the game is over.");
    this.endGame();
    this.seats = this.seats.filter((s) => !s.isAi);
    for (const s of this.seats) {
      delete s.nickname;
      delete s.emoji;
    }
    this.preparePersona();
    enterPhase(this, "lobby");
    return { ok: true };
  }

  /** Disposes the AI and clears all per-game state (keeps seats and usedPromptIds). */
  private endGame(): void {
    this.clearTimer();
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    try {
      this.ai?.dispose();
    } catch (e) {
      this.log(`ai.dispose threw: ${errMsg(e)}`);
    }
    this.ai = null;
    this.aiId = null;
    this.aiQueue = [];
    this.roundNumber = null;
    this.rounds = [];
    this.currentRound = null;
    this.answers.clear();
    this.messages = [];
    this.votes.clear();
    this.voteHistory.clear();
    this.pairs = [];
    this.collabDraft.clear();
    this.collabResults = null;
    this.vouchDraft.clear();
    this.vouches = null;
    this.reveal = null;
    this.partnerCards.clear();
    this.matchmakerPromise = null;
    this.matchmakerOutput = null;
  }

  /** Room deleted (TTL or shutdown). Tells every socket, then stops everything. */
  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    const sockets = [...this.spectators, ...this.seats.flatMap((s) => [...s.socketIds])];
    for (const sid of sockets) this.deps.transport.closed(sid, reason);
    this.endGame();
    this.personaAbort?.abort();
    this.log(`closed (${reason})`);
  }

  // ── timers ─────────────────────────────────────────────────────────────────

  clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Ends the current phase in ms. */
  schedulePhaseEnd(ms: number): void {
    this.clearTimer();
    this.phaseEndsAt = Date.now() + ms;
    const seq = this.phaseSeq;
    this.timer = setTimeout(() => {
      if (seq === this.phaseSeq) void this.safeAdvance();
    }, ms);
  }

  /** Ends the phase sooner (never later) than currently scheduled. */
  shortenPhase(ms: number): void {
    if (this.phaseEndsAt !== null && this.phaseEndsAt - Date.now() > ms) this.schedulePhaseEnd(ms);
  }

  async safeAdvance(): Promise<void> {
    try {
      await advance(this);
    } catch (e) {
      this.log(`advance from ${this.phase} failed: ${errMsg(e)}`);
    }
  }

  // ── output ─────────────────────────────────────────────────────────────────

  /** Fresh RoomView to every connected viewer, then notifies the AI. */
  broadcast(aiEvent: GameEvent = { type: "stateUpdated" }): void {
    if (this.closed) return;
    this.emitToSeats(this.seats.map((s) => s.id));
    if (this.spectators.size > 0) {
      const view = buildView(this, null);
      for (const sid of this.spectators) this.deps.transport.state(sid, view);
    }
    this.queueAiEvent(aiEvent);
  }

  /** Sends the latest state to one socket (after rejoin/watch). */
  sendStateTo(socketId: string, viewerId: PlayerId | null): void {
    this.deps.transport.state(socketId, buildView(this, viewerId));
  }

  private emitToSeats(ids: readonly PlayerId[]): void {
    for (const id of ids) {
      const seat = this.seat(id);
      if (!seat || seat.isAi || seat.socketIds.size === 0) continue;
      const view = buildView(this, seat.id);
      for (const sid of seat.socketIds) this.deps.transport.state(sid, view);
    }
  }

  // ── AI virtual client ──────────────────────────────────────────────────────

  /** Events are delivered asynchronously so an AI acting inside onEvent can't re-enter the room. */
  queueAiEvent(event: GameEvent): void {
    if (!this.ai || !this.aiId) return;
    const last = this.aiQueue[this.aiQueue.length - 1];
    if (event.type === "stateUpdated" && last?.type === "stateUpdated") return;
    this.aiQueue.push(event);
    if (this.aiDrainScheduled) return;
    this.aiDrainScheduled = true;
    setImmediate(() => this.drainAiQueue());
  }

  private drainAiQueue(): void {
    this.aiDrainScheduled = false;
    const events = this.aiQueue;
    this.aiQueue = [];
    for (const event of events) {
      const ai = this.ai;
      const aiId = this.aiId;
      if (!ai || !aiId || this.closed) return;
      try {
        // Cloned so the AI can never mutate room state through the view.
        ai.onEvent(event, structuredClone(buildView(this, aiId)));
      } catch (e) {
        this.log(`ai.onEvent(${event.type}) threw: ${errMsg(e)}`);
      }
    }
  }

  /**
   * Round 1 only: the humans' submitted answers so far, sent privately to the AI
   * controller so it can answer in the room's style (PART_2_DESIGN §3.8.1). It
   * goes through the AI's internal event queue only, never into a RoomView or a
   * socket. Sent once when round 1's answer phase opens, then after every
   * accepted human submission; AI submissions don't trigger it.
   */
  private publishFirstQuestionAnswers(): void {
    if (!this.ai || !this.aiId || this.phase !== "answer" || this.roundNumber !== 1 || !this.currentRound) return;
    const humans = this.humans();
    const answers = humans
      .filter((s) => this.answers.has(s.id))
      .map((s) => ({ playerId: s.id, nickname: s.nickname ?? "", text: this.answers.get(s.id)! }));
    this.queueAiEvent({
      type: "firstQuestionAnswersUpdated",
      snapshot: {
        sessionGeneration: this.sessionGeneration,
        round: 1,
        promptId: this.currentRound.promptId,
        question: this.currentRound.prompt,
        revision: ++this.firstQuestionRevision,
        humanPlayerIds: humans.map((s) => s.id),
        submittedCount: answers.length,
        answers,
      },
    });
  }

  private aiActions(aiId: PlayerId): AiActions {
    // Same Room methods the socket handlers call, then the same broadcast.
    const run = <T extends object>(fn: () => AckResult<T>): AckResult<T> => {
      if (this.aiId !== aiId || this.closed) return fail("Game over.");
      try {
        const res = fn();
        if (res.ok) this.broadcast();
        return res;
      } catch (e) {
        this.log(`AI action threw: ${errMsg(e)}`);
        return fail("Server error.");
      }
    };
    return {
      submitAnswer: (text) => run(() => this.submitAnswer(aiId, String(text))),
      sendChat: (text, channel) => run(() => this.sendChat(aiId, String(text), channel)),
      castVote: (targetId) => run(() => this.castVote(aiId, targetId)),
      submitCollab: (text) => run(() => this.submitCollab(aiId, String(text))),
      setVouch: (targetId, vouched) => run(() => this.setVouch(aiId, targetId, Boolean(vouched))),
    };
  }
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
