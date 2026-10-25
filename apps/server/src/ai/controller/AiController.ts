// The AI player's brain (docs/PART_4_AI_RUNTIME_CONTENT.md §3). It decides WHEN
// the AI acts and how long it "types"; Part 2's builders and humanizers decide
// WHAT it says. It sees only its own RoomView and acts only through AiActions,
// exactly like a human seat. It must never throw out of onEvent and never stall
// the game: every Muse call has a timeout and every required action a fallback.
import { DEFAULT_TIMERS, LIMITS } from "@game/shared";
import type {
  AckResult, AiActions, AiMode, AiNoteView, AiPlayer, AiPlayerInit, AiTurnContext, Channel,
  ChatMessage, FirstQuestionAnswerSnapshot, GameEvent, Persona, Phase, PlayerId, RoomCode, RoomView, RoundNumber,
} from "@game/shared";
import type { MuseCallFn } from "../muse.js";
import { median, oneLine, pick, sleep, truncateAtWord, uniform } from "../util.js";
import {
  ADDRESSED_REPLY_P, DISCUSS_OPENER_P, PAIR_OPENER_P, PAIR_REPLY_P,
  classifyMessage, replyProbability, type Addressing,
} from "./cadence.js";
import { VOUCH_P, chooseFinalVote, chooseSuspicionVote, nicknameOf, voteNote, vouchNote } from "./decisions.js";
import type { ControllerDeps, HumannessDeps, PlayerTurnContext, SessionMemory } from "./deps.js";
import { selectRevealNotes, type NoteKind, type NoteRecord } from "./notes.js";
import {
  DEADLINE_GUARD_MS, MIN_GAP_MS, MIN_PHASE_LEFT_MS, STALE_AFTER_MESSAGES, computeSendAt, slotAt,
} from "./timing.js";

type Timer = ReturnType<typeof setTimeout>;
type Trigger = AiTurnContext["trigger"];

interface PhaseState {
  key: number;
  phase: Phase;
  round: RoundNumber | null;
  /** Local clock (ms). */
  startedAt: number;
  endsAt: number | null;
  /** Aborted when the phase ends: cancels this phase's Muse calls and waits. */
  ac: AbortController;
}

/** A one-shot action in the current phase (answer, vote, collab result). */
interface Slot {
  done: boolean;
  /** The random moment we planned to act. */
  slotAt: number;
  /** Set once every human has acted, so the AI doesn't keep everyone waiting. */
  earlyAt: number | null;
  timer: Timer | null;
  result: GenResult | null;
  /** Round 1 answer only: generation has started (it waits for every human's answer first). */
  started?: boolean;
  /** Round 1 answer only: generating at the reserve deadline without every human's answer. */
  deadlineException?: boolean;
}

interface ChatRequest {
  key: number;
  channel: Channel;
  trigger: Trigger;
  /** Local time the trigger became visible (or the opener fired). */
  triggerAt: number;
  addressed: boolean;
  accused: boolean;
}

type GenResult =
  | { kind: "text"; text: string; note: string }
  | { kind: "skip" }
  | { kind: "failed"; reason: string };

type FallbackKind = "light" | "personal" | "collab" | "group" | "accused" | "pair";

const MODE_LIMITS: Record<AiMode, number> = {
  answer: LIMITS.answerMaxChars,
  group: LIMITS.chatMaxChars,
  pair: LIMITS.chatMaxChars,
  collab: LIMITS.collabMaxChars,
};

/** Don't start a Muse call with less time than this to wait for it. */
const MIN_CALL_MS = 1_500;
/** Chat turns keep this much of the phase free for typing time and the 4s rule. */
const CHAT_RESERVE_MS = MIN_PHASE_LEFT_MS + 2_000;
/** Answer / collab calls must finish a little before the deadline guard. */
const SLOT_RESERVE_MS = DEADLINE_GUARD_MS + 500;
/**
 * Round 1: if some humans still haven't answered this long before the deadline
 * guard, generate anyway with the answers we have (PART_2_DESIGN §2.7.1: baseline
 * p90 generation time, 6s until measured).
 */
const FIRST_ANSWER_RESERVE_MS = 6_000;

function museTimeoutMs(): number {
  return Number(process.env.MUSE_TIMEOUT_MS) || 12_000;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** Sanity-check Part 2's structured output (museCall is a cast, not a validation). */
function parseOutput(mode: AiMode, raw: unknown): { skip: true } | { skip: false; text: string; note: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const note = typeof o.note === "string" ? o.note : "";
  switch (mode) {
    case "answer":
      return typeof o.answer === "string" ? { skip: false, text: o.answer, note } : null;
    case "collab":
      return typeof o.result === "string" ? { skip: false, text: o.result, note } : null;
    default:
      if (o.action === "skip") return { skip: true };
      return o.action === "send" && typeof o.message === "string" ? { skip: false, text: o.message, note } : null;
  }
}

export class AiController implements AiPlayer {
  private readonly roomCode: RoomCode;
  private readonly sessionGeneration: string;
  private readonly aiId: PlayerId;
  private readonly persona: Persona;
  private readonly actions: AiActions;
  private readonly h: HumannessDeps;
  private readonly call: MuseCallFn;
  private readonly random: () => number;
  private readonly logRoomStats: ((roomCode: string) => void) | undefined;

  private view: RoomView | null = null;
  /** Local clock minus server clock, refreshed on every event. */
  private clockOffset = 0;
  private phase: PhaseState | null = null;
  private phaseSeq = 0;
  private disposed = false;
  private readonly timers = new Set<Timer>();

  private readonly saidSoFar: string[] = [];
  private readonly myAnswers: string[] = [];
  private readonly notes: NoteRecord[] = [];
  private noteSeq = 0;
  private readonly usedFallbacks = new Set<string>();
  private readonly seenMessages = new Set<string>();
  /** Part 2's per-game memory; null if Part 2 doesn't provide it or it failed (builders then derive it). */
  private memory: SessionMemory | null = null;
  /** Newest private snapshot of the humans' round-1 answers (PART_2_DESIGN §3.8.1). */
  private firstSnapshot: FirstQuestionAnswerSnapshot | null = null;

  // Per phase.
  private answer: Slot | null = null;
  private vote: Slot | null = null;
  private collab: Slot | null = null;
  private guard: Timer | null = null;
  private guardFn: (() => void) | null = null;
  private chatInFlight = false;
  private pendingChat: ChatRequest | null = null;
  private myGroupCount = 0;
  private humanGroupCounts = new Map<PlayerId, number>();

  // Per game.
  private readonly lastSentAt: Record<Channel, number> = { group: -Infinity, pair: -Infinity };
  private sentPairMessage = false;

  constructor(init: AiPlayerInit, deps: ControllerDeps) {
    this.roomCode = init.roomCode;
    this.sessionGeneration = init.sessionGeneration;
    this.aiId = init.aiPlayerId;
    this.persona = init.persona;
    this.actions = init.actions;
    this.h = deps.humanness;
    this.call = deps.call;
    this.random = deps.random ?? Math.random;
    this.logRoomStats = deps.logRoomStats;
  }

  // ── AiPlayer ──────────────────────────────────────────────────────────────

  onEvent(event: GameEvent, view: RoomView): void {
    if (this.disposed) return;
    try {
      this.view = view;
      this.clockOffset = this.now() - view.serverNow;
      this.syncMemory(view);
      this.syncPhaseEnd(view);
      switch (event.type) {
        case "firstQuestionAnswersUpdated":
          this.onFirstQuestionSnapshot(event.snapshot);
          break;
        case "gameStarted":
          if (!this.phase && view.phase !== "lobby") this.enterPhase(view.phase, view.round?.number ?? null, view);
          break;
        case "phaseChanged":
          if (this.phase?.phase === event.phase && this.phase.round === event.round) break;
          this.enterPhase(event.phase, event.round, view);
          break;
        case "messageVisible":
          this.onMessage(event.message);
          break;
        case "stateUpdated":
          if (this.phase?.phase === "answer") this.maybeSubmitAnswer();
          if (this.phase?.phase === "vote" || this.phase?.phase === "finalVote") this.maybeCastVote();
          break;
      }
    } catch (err) {
      this.log(`onEvent(${event.type}) failed`, err);
    }
  }

  getRevealInfo(): { persona: { name: string; blurb: string }; notes: AiNoteView[] } {
    // Personas have no name (PART_2_DESIGN §2.2): the reveal shows the AI's game nickname.
    const name = this.myNickname() || "the AI";
    try {
      return { persona: { name, blurb: this.persona.blurb }, notes: selectRevealNotes(this.notes) };
    } catch (err) {
      this.log("getRevealInfo failed", err);
      return { persona: { name, blurb: "" }, notes: [] };
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.clearPhase();
    this.disposed = true;
    this.pendingChat = null;
    this.firstSnapshot = null;
    try {
      if (this.memory) this.h.disposeSessionMemory?.(this.memory);
    } catch {
      // memory is in-process only; nothing to recover
    }
    this.memory = null;
    try {
      this.logRoomStats?.(this.roomCode);
    } catch {
      // stats are best effort
    }
  }

  // ── Part 2 memory and the private round-1 feed ───────────────────────────

  /** Keep Part 2's session memory in step with what the AI can see. On any failure, run without it. */
  private syncMemory(view: RoomView): void {
    const h = this.h;
    if (!h.createSessionMemory || !h.updateSessionMemory) return;
    try {
      if (!this.memory) {
        if (view.players.length === 0) return;
        this.memory = h.createSessionMemory(this.sessionGeneration, view.players);
      }
      h.updateSessionMemory(this.memory, view, this.aiId);
    } catch (err) {
      this.log("session memory failed, continuing without it", err);
      this.memory = null;
    }
  }

  /** Record an accepted action in Part 2's memory, so later turns stay consistent with it. */
  private remember(
    mode: AiMode,
    text: string,
    note: string,
    ack: AckResult<{ messageId?: string; visibleAt?: number }>,
  ): void {
    const round = this.view?.round;
    if (!this.memory || !this.h.recordAcceptedOutput || !round || !ack.ok) return;
    const messageId = ack.messageId;
    try {
      this.h.recordAcceptedOutput(this.memory, ack, {
        key: `${this.sessionGeneration}:${round.number}:${mode}:${messageId ?? "submission"}`,
        text,
        mode,
        round: round.number,
        promptId: round.promptId,
        question: round.prompt,
        messageId,
        visibleAt: ack.visibleAt,
        visibility: messageId ? "pending" : "visible",
        note,
      });
    } catch (err) {
      this.log("recording accepted output failed", err);
    }
  }

  /** Server-only snapshot of the humans' submitted round-1 answers. Keep the newest valid one. */
  private onFirstQuestionSnapshot(snapshot: FirstQuestionAnswerSnapshot): void {
    const p = this.phase;
    const round = this.view?.round;
    if (!p || p.phase !== "answer" || p.round !== 1 || !round) return;
    if (
      snapshot.round !== 1 ||
      snapshot.sessionGeneration !== this.sessionGeneration ||
      snapshot.promptId !== round.promptId
    ) {
      return this.log("ignored a round-1 snapshot for another game or question");
    }
    if (this.firstSnapshot && snapshot.revision <= this.firstSnapshot.revision) return;
    this.firstSnapshot = snapshot;
    this.maybeStartFirstAnswer();
  }

  /** Round 1 waits for every human's answer, then generates from them (PART_2_DESIGN §2.7.1). */
  private maybeStartFirstAnswer(): void {
    const s = this.firstSnapshot;
    if (s && s.humanPlayerIds.length > 0 && s.submittedCount >= s.humanPlayerIds.length) this.startFirstAnswer(false);
  }

  private startFirstAnswer(deadlineException: boolean): void {
    const slot = this.answer;
    const p = this.phase;
    if (!slot || !p || slot.done || slot.started) return;
    slot.started = true;
    slot.deadlineException = deadlineException;
    if (deadlineException) this.log("r1 answer: generating at the reserve deadline without every human's answer");
    void this.generate("answer", { kind: "phaseStart" }, false, p.key, SLOT_RESERVE_MS)
      .then((result) => {
        if (!this.isCurrent(p.key)) return;
        slot.result = result;
        this.maybeSubmitAnswer();
      })
      .catch((err: unknown) => this.log("answer task failed", err));
  }

  // ── Phases ────────────────────────────────────────────────────────────────

  private enterPhase(phase: Phase, round: RoundNumber | null, view: RoomView): void {
    this.clearPhase();
    this.phase = {
      key: ++this.phaseSeq,
      phase,
      round,
      startedAt: this.now(),
      endsAt: view.phaseEndsAt == null ? null : this.toLocal(view.phaseEndsAt),
      ac: new AbortController(),
    };
    this.answer = this.vote = this.collab = null;
    this.pendingChat = null;
    this.myGroupCount = 0;
    this.humanGroupCounts = new Map();

    switch (phase) {
      case "answer":
        return this.startAnswer();
      case "discuss":
        return this.startDiscuss();
      case "vote":
      case "finalVote":
        return this.startVote();
      case "pairChat":
        return this.startPairChat();
      case "pairResults":
        return this.startVouches();
      default:
        // voteResult: nothing to do. reveal / partners / lobby: clearPhase() already stopped everything.
        return;
    }
  }

  /** The server can move phaseEndsAt (everyone answered, host skip). Follow it. */
  private syncPhaseEnd(view: RoomView): void {
    const p = this.phase;
    if (!p || view.phase !== p.phase) return;
    const endsAt = view.phaseEndsAt == null ? null : this.toLocal(view.phaseEndsAt);
    if (endsAt === p.endsAt) return;
    p.endsAt = endsAt;
    this.rearmGuard();
  }

  private startAnswer(): void {
    const p = this.phase!;
    const slot = this.newSlot(0.35, 0.85);
    this.answer = slot;
    this.armGuard(() => {
      if (!slot.done) this.submitAnswer(slot, this.answerFallback(), "deadline");
    });
    if (p.round === 1) {
      // Round 1 (PART_2_DESIGN §2.7.1): wait for every human's answer via the private
      // snapshot, generate from them, and submit as soon as the answer is ready. If
      // someone is still typing near the end, generate anyway with what we have.
      slot.slotAt = p.startedAt;
      this.firstSnapshot = null;
      if (p.endsAt != null) {
        this.at(p.endsAt - DEADLINE_GUARD_MS - FIRST_ANSWER_RESERVE_MS, () => this.startFirstAnswer(true));
      }
      this.maybeStartFirstAnswer();
      return;
    }
    void this.generate("answer", { kind: "phaseStart" }, false, p.key, SLOT_RESERVE_MS)
      .then((result) => {
        if (!this.isCurrent(p.key)) return;
        slot.result = result;
        this.maybeSubmitAnswer();
      })
      .catch((err: unknown) => this.log("answer task failed", err));
    this.maybeSubmitAnswer();
  }

  private maybeSubmitAnswer(): void {
    const slot = this.answer;
    if (!slot || slot.done) return;
    const progress = this.view?.answerProgress;
    if (slot.earlyAt == null && progress && progress.total > 1 && progress.answered >= progress.total - 1) {
      slot.earlyAt = this.now() + uniform(2_000, 5_000, this.random);
    }
    if (!this.waitForSlot(slot, () => this.maybeSubmitAnswer())) return;
    const r = slot.result;
    if (!r) return; // still generating: the result handler (or the deadline guard) submits
    if (r.kind === "text") this.submitAnswer(slot, { text: r.text, note: r.note }, "model");
    else this.submitAnswer(slot, this.answerFallback(), r.kind === "failed" ? `fallback: ${r.reason}` : "fallback");
  }

  private submitAnswer(slot: Slot, answer: { text: string; note: string } | null, source: string): void {
    if (slot.done || !answer) return;
    const text = truncateAtWord(oneLine(answer.text), LIMITS.answerMaxChars);
    const round = this.phase?.round ?? null;
    const pct = this.phasePct();
    slot.done = true; // before acting: the server may call onEvent re-entrantly
    const res = this.actions.submitAnswer(text);
    if (!res.ok) {
      slot.done = false;
      this.log(`answer rejected (${res.error})`);
      return;
    }
    this.cancel(slot.timer);
    this.saidSoFar.push(text);
    this.myAnswers.push(text);
    this.remember("answer", text, answer.note, res);
    this.addNote("answer", answer.note, round);
    this.log(`r${round ?? "?"} answer submitted (${source}) at ${pct}%`);
  }

  private startDiscuss(): void {
    if (this.random() >= DISCUSS_OPENER_P) return;
    const p = this.phase!;
    this.at(p.startedAt + uniform(6_000, 14_000, this.random), () =>
      this.requestChat({
        key: p.key, channel: "group", trigger: { kind: "phaseStart" },
        triggerAt: this.now(), addressed: false, accused: false,
      }),
    );
  }

  private startVote(): void {
    this.vote = this.newSlot(0.3, 0.8);
    this.maybeCastVote();
  }

  private maybeCastVote(): void {
    const slot = this.vote;
    if (!slot || slot.done) return;
    const progress = this.view?.voteProgress;
    if (slot.earlyAt == null && progress && progress.total > 1 && progress.voted >= progress.total - 1) {
      slot.earlyAt = this.now() + uniform(1_000, 3_000, this.random);
    }
    if (!this.waitForSlot(slot, () => this.maybeCastVote())) return;

    const view = this.view!;
    const final = this.phase?.phase === "finalVote";
    const round = this.phase?.round ?? null;
    const humans = this.humans();
    const choice = final
      ? chooseFinalVote(humans, new Set(this.myPartners()), view.history, this.random)
      : chooseSuspicionVote(humans, view.history, this.random);
    if (!choice) return;
    const pct = this.phasePct();
    slot.done = true; // one attempt; a rejected vote just counts as abstaining
    const res = this.actions.castVote(choice.targetId);
    if (!res.ok) {
      this.log(`vote rejected (${res.error})`);
      return;
    }
    this.cancel(slot.timer);
    this.addNote(final ? "finalVote" : "vote", voteNote(choice, nicknameOf(view.players, choice.targetId), final, this.random), round);
    this.log(`${final ? "final vote" : `r${round ?? "?"} vote`} cast (${choice.reason}) at ${pct}%`);
  }

  private startPairChat(): void {
    const p = this.phase!;
    if (this.myPartners().length > 0 && this.random() < PAIR_OPENER_P) {
      this.at(p.startedAt + uniform(4_000, 10_000, this.random), () =>
        this.requestChat({
          key: p.key, channel: "pair", trigger: { kind: "phaseStart" },
          triggerAt: this.now(), addressed: false, accused: false,
        }),
      );
    }
    const slot = this.newSlot(0.55, 0.85);
    this.collab = slot;
    this.armGuard(() => {
      if (!slot.done) this.submitCollab(slot, this.collabFallback(), "deadline");
    });
    slot.timer = this.at(slot.slotAt, () => this.runCollab(slot, p.key));
  }

  private async runCollab(slot: Slot, key: number): Promise<void> {
    const result = await this.generate("collab", { kind: "idle" }, false, key, SLOT_RESERVE_MS);
    if (!this.isCurrent(key) || slot.done) return;
    if (result.kind === "text") this.submitCollab(slot, { text: result.text, note: result.note }, "model");
    else this.submitCollab(slot, this.collabFallback(), result.kind === "failed" ? `fallback: ${result.reason}` : "fallback");
  }

  private submitCollab(slot: Slot, collab: { text: string; note: string } | null, source: string): void {
    if (slot.done || !collab) return;
    const text = truncateAtWord(oneLine(collab.text), LIMITS.collabMaxChars);
    const round = this.phase?.round ?? null;
    slot.done = true;
    const res = this.actions.submitCollab(text);
    if (!res.ok) {
      slot.done = false;
      this.log(`collab rejected (${res.error})`);
      return;
    }
    this.saidSoFar.push(text);
    this.remember("collab", text, collab.note, res);
    this.addNote("collab", collab.note, round);
    this.log(`collab result submitted (${source})`);
  }

  private startVouches(): void {
    const p = this.phase!;
    const end = this.phaseEnd(p);
    for (const partner of this.myPartners()) {
      this.at(slotAt(p.startedAt, end, 0.3, 0.7, this.random), () => {
        const vouched = this.random() < VOUCH_P;
        const round = this.phase?.round ?? null;
        const res = this.actions.setVouch(partner, vouched);
        if (!res.ok) return this.log(`vouch rejected (${res.error})`);
        this.addNote("vouch", vouchNote(vouched, nicknameOf(this.view?.players ?? [], partner), this.random), round);
        this.log(`vouch set (${vouched})`);
      });
    }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  private onMessage(msg: ChatMessage): void {
    if (this.seenMessages.has(msg.id)) return;
    this.seenMessages.add(msg.id);
    const p = this.phase;
    if (!p || msg.from === this.aiId) return;
    const triggerAt = this.toLocal(msg.at);

    if (msg.channel === "group") {
      if (p.phase !== "discuss") return;
      this.humanGroupCounts.set(msg.from, (this.humanGroupCounts.get(msg.from) ?? 0) + 1);
      const decision = this.decideGroupReply(msg);
      if (decision) this.requestChat({ key: p.key, channel: "group", trigger: { kind: "message", message: msg }, triggerAt, ...decision });
      return;
    }

    if (p.phase !== "pairChat" || msg.pairId !== this.myPairId()) return;
    if (this.random() >= PAIR_REPLY_P) return;
    const { accused } = classifyMessage(msg.text, this.myNickname(), this.myAnswers);
    this.requestChat({ key: p.key, channel: "pair", trigger: { kind: "message", message: msg }, triggerAt, addressed: true, accused });
  }

  /** Roll whether to answer a human group message. Null = stay quiet. */
  private decideGroupReply(msg: ChatMessage): Addressing | null {
    const a = classifyMessage(msg.text, this.myNickname(), this.myAnswers);
    const counts = this.humans().map((id) => this.humanGroupCounts.get(id) ?? 0);
    const p = a.addressed ? ADDRESSED_REPLY_P : replyProbability(median(counts), this.myGroupCount);
    return this.random() < p ? a : null;
  }

  /** At most one chat turn in flight; while busy, keep only the most relevant newer trigger. */
  private requestChat(req: ChatRequest): void {
    if (this.chatInFlight) {
      if (!this.pendingChat || req.addressed || !this.pendingChat.addressed) this.pendingChat = req;
      return;
    }
    void this.runChat(req);
  }

  private async runChat(req: ChatRequest): Promise<void> {
    this.chatInFlight = true;
    try {
      await this.chatTurn(req, false);
    } catch (err) {
      if (errorName(err) !== "AbortedError") this.log("chat turn failed", err);
    } finally {
      this.chatInFlight = false;
      const next = this.pendingChat;
      this.pendingChat = null;
      if (next && this.isCurrent(next.key)) void this.runChat(next);
    }
  }

  private async chatTurn(req: ChatRequest, redecided: boolean): Promise<void> {
    if (!this.isCurrent(req.key) || this.msLeft() < CHAT_RESERVE_MS) return;
    const isReply = req.trigger.kind === "message";
    const gen = await this.generate(req.channel, req.trigger, req.addressed, req.key, CHAT_RESERVE_MS);
    if (!this.isCurrent(req.key) || gen.kind === "skip") return;

    let text: string;
    let note: string;
    if (gen.kind === "text") {
      ({ text, note } = gen);
    } else {
      // Nobody is waiting on an opener or an unaddressed group message: silence beats a canned line.
      if (!isReply || (req.channel === "group" && !req.addressed)) return;
      const line = this.pickFallback(req.channel === "pair" ? "pair" : req.accused ? "accused" : "group");
      if (!line) return;
      text = truncateAtWord(oneLine(line), LIMITS.chatMaxChars);
      note = req.accused ? "got called the bot and my brain lagged, so i just played it off" : "";
    }

    const sendAt = Math.max(
      computeSendAt(req.triggerAt, text.length, this.random, isReply),
      this.lastSentAt[req.channel] + MIN_GAP_MS,
      this.now(),
    );
    if (this.endsAtOrInfinity() - sendAt < MIN_PHASE_LEFT_MS) return this.log(`${req.channel} reply dropped (too close to phase end)`);
    await sleep(sendAt - this.now(), this.phase!.ac.signal);
    if (!this.isCurrent(req.key) || this.msLeft() < MIN_PHASE_LEFT_MS) return;

    // Stale check: the conversation moved on while we were "typing".
    if (req.trigger.kind === "message" && !req.addressed) {
      const newer = this.newerHumanMessages(req.trigger.message);
      if (newer.length >= STALE_AFTER_MESSAGES) {
        const latest = newer[newer.length - 1]!;
        const decision = redecided || req.channel !== "group" ? null : this.decideGroupReply(latest);
        this.log(`${req.channel} reply dropped as stale${decision ? ", re-deciding on the latest message" : ""}`);
        if (decision) {
          await this.chatTurn(
            { ...req, trigger: { kind: "message", message: latest }, triggerAt: this.toLocal(latest.at), ...decision },
            true,
          );
        }
        return;
      }
    }

    const round = this.phase?.round ?? null;
    const res = this.actions.sendChat(text, req.channel);
    if (!res.ok) return this.log(`${req.channel} message rejected (${res.error})`);
    this.lastSentAt[req.channel] = this.now();
    this.saidSoFar.push(text);
    this.remember(req.channel, text, note, res);
    if (req.channel === "group") {
      this.myGroupCount++;
      this.addNote("discuss", note, round, req.accused);
    } else {
      this.addNote(this.sentPairMessage ? "pair" : "pairOpener", note, round, req.accused);
      this.sentPairMessage = true;
    }
    this.log(`${req.channel} message sent (${gen.kind === "text" ? "model" : "fallback"}${req.addressed ? ", addressed" : ""})`);
  }

  private newerHumanMessages(trigger: ChatMessage): ChatMessage[] {
    return (this.view?.messages ?? []).filter(
      (m) => m.channel === trigger.channel && m.pairId === trigger.pairId && m.at > trigger.at && m.from !== this.aiId,
    );
  }

  // ── Muse pipeline: builder → museCall → humanize → validate (regenerate once) ──

  private async generate(mode: AiMode, trigger: Trigger, addressed: boolean, key: number, reserveMs: number): Promise<GenResult> {
    let reason = "no time";
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = this.phase;
      if (!p || !this.isCurrent(key)) return { kind: "failed", reason: "phase over" };
      const timeoutMs = Math.min(museTimeoutMs(), this.msLeft() - reserveMs);
      if (timeoutMs < MIN_CALL_MS) return { kind: "failed", reason };
      // Absolute cutoff for this call, retry included (PART_2_DESIGN §3.2.1).
      const deadlineAtMs = p.endsAt == null ? undefined : p.endsAt - reserveMs;
      try {
        const ctx = this.buildCtx(mode, trigger, addressed, deadlineAtMs);
        const raw = await this.call<unknown>(this.builderFor(mode)(ctx), {
          label: mode, timeoutMs, deadlineAtMs, signal: p.ac.signal, roomCode: this.roomCode,
        });
        if (!this.isCurrent(key)) return { kind: "failed", reason: "phase over" };
        const out = parseOutput(mode, raw);
        if (!out) {
          reason = "malformed output";
          continue;
        }
        if (out.skip) {
          if (!addressed) return { kind: "skip" };
          // Someone talked to the AI directly: skipping isn't allowed (PART_2_DESIGN §2.7.2).
          reason = "skipped a turn addressed to it";
          continue;
        }
        const text = truncateAtWord(oneLine(this.h.humanize(out.text, ctx.style, this.persona)), MODE_LIMITS[mode]);
        const verdict = text ? this.h.validateOutput(text) : ({ ok: false, reason: "empty" } as const);
        if (verdict.ok) return { kind: "text", text, note: out.note };
        reason = `invalid: ${verdict.reason}`;
      } catch (err) {
        // museCall already retried transient errors once; don't pay for another attempt.
        return { kind: "failed", reason: errorName(err) };
      }
    }
    this.log(`${mode} output rejected twice (${reason})`);
    return { kind: "failed", reason };
  }

  private builderFor(mode: AiMode): (ctx: PlayerTurnContext) => ReturnType<HumannessDeps["buildAnswerRequest"]> {
    switch (mode) {
      case "answer": return (ctx) => this.h.buildAnswerRequest(ctx);
      case "group": return (ctx) => this.h.buildGroupChatRequest(ctx);
      case "pair": return (ctx) => this.h.buildPairChatRequest(ctx);
      case "collab": return (ctx) => this.h.buildCollabRequest(ctx);
    }
  }

  private buildCtx(mode: AiMode, trigger: Trigger, addressed: boolean, cutoffAt?: number): PlayerTurnContext {
    const view = this.view!;
    const answers = view.history.flatMap((r) => r.answers);
    const firstQuestion = mode === "answer" && this.phase?.round === 1;
    return {
      // Part 2's extensions (PART_2_DESIGN §2.3): memory, the round-1 snapshot and the cutoff.
      memory: this.memory ?? undefined,
      firstQuestionHumanAnswers: firstQuestion ? (this.firstSnapshot ?? undefined) : undefined,
      firstQuestionDeadlineException: firstQuestion ? Boolean(this.answer?.deadlineException) : undefined,
      generationCutoffAt: cutoffAt,
      nowMs: this.now(),
      mode,
      persona: this.persona,
      view,
      aiPlayerId: this.aiId,
      myNickname: this.myNickname(),
      style: this.h.computeStyleProfile(view.messages, answers, this.aiId),
      trigger,
      addressedToMe: addressed,
      saidSoFar: [...this.saidSoFar],
      secondsLeftInPhase: Math.max(0, Math.round(Math.min(this.msLeft(), 3_600_000) / 1000)),
    };
  }

  // ── Fallbacks and notes ───────────────────────────────────────────────────

  /** A Part 2 fallback line, avoiding repeats within the game. */
  private pickFallback(kind: FallbackKind): string | null {
    try {
      const lines = this.h.FALLBACK_LINES;
      const pool = (kind === "light" || kind === "personal" ? lines.answer[kind] : lines[kind]) ?? [];
      const fresh = pool.filter((l) => !this.usedFallbacks.has(l));
      const line = pick(fresh.length > 0 ? fresh : pool, this.random);
      if (!line) return null;
      this.usedFallbacks.add(line);
      return line;
    } catch (err) {
      this.log("fallback lines unavailable", err);
      return null;
    }
  }

  private answerFallback(): { text: string; note: string } | null {
    const line = this.pickFallback(this.view?.round?.tier === "personal" ? "personal" : "light");
    return line ? { text: line, note: "my brain lagged so i just typed the safest answer i could think of" } : null;
  }

  private collabFallback(): { text: string; note: string } | null {
    const line = this.pickFallback("collab");
    return line ? { text: line, note: "ran out of time on the collab so i kept it vague" } : null;
  }

  private addNote(kind: NoteKind, text: string, round: RoundNumber | null, accused = false): void {
    if (!text?.trim()) return;
    this.notes.push({ kind, round, text, accused, seq: ++this.noteSeq });
  }

  // ── Timers and helpers ────────────────────────────────────────────────────

  private now(): number {
    return Date.now();
  }

  private toLocal(serverTime: number): number {
    return serverTime + this.clockOffset;
  }

  private isCurrent(key: number): boolean {
    return !this.disposed && this.phase?.key === key;
  }

  private phaseEnd(p: PhaseState): number {
    return p.endsAt ?? p.startedAt + (DEFAULT_TIMERS[p.phase] ?? 20_000);
  }

  private endsAtOrInfinity(): number {
    return this.phase?.endsAt ?? Infinity;
  }

  private msLeft(): number {
    return this.endsAtOrInfinity() - this.now();
  }

  private phasePct(): number {
    const p = this.phase;
    if (!p) return 0;
    return Math.round((100 * (this.now() - p.startedAt)) / Math.max(1, this.phaseEnd(p) - p.startedAt));
  }

  private newSlot(lo: number, hi: number): Slot {
    const p = this.phase!;
    return { done: false, slotAt: slotAt(p.startedAt, this.phaseEnd(p), lo, hi, this.random), earlyAt: null, timer: null, result: null };
  }

  /** True when the slot's moment has come; otherwise (re)schedules `again` for it. */
  private waitForSlot(slot: Slot, again: () => void): boolean {
    const when = Math.min(slot.slotAt, slot.earlyAt ?? Infinity);
    if (this.now() >= when) return true;
    this.cancel(slot.timer);
    slot.timer = this.at(when, again);
    return false;
  }

  private humans(): PlayerId[] {
    return (this.view?.players ?? []).map((p) => p.id).filter((id) => id !== this.aiId);
  }

  private myNickname(): string {
    return this.view?.me?.nickname ?? "";
  }

  private myPairId(): string | null {
    const view = this.view;
    return view?.me?.myPairId ?? view?.pairs?.find((p) => p.members.includes(this.aiId))?.id ?? null;
  }

  private myPartners(): PlayerId[] {
    const pairId = this.myPairId();
    const pair = this.view?.pairs?.find((p) => p.id === pairId);
    return pair ? pair.members.filter((id) => id !== this.aiId) : [];
  }

  private armGuard(fn: () => void): void {
    this.guardFn = fn;
    this.rearmGuard();
  }

  /** Deadline guard: fires DEADLINE_GUARD_MS before the (possibly moved) phase end. */
  private rearmGuard(): void {
    this.cancel(this.guard);
    this.guard = null;
    const p = this.phase;
    if (!p || p.endsAt == null || !this.guardFn) return;
    this.guard = this.at(p.endsAt - DEADLINE_GUARD_MS, this.guardFn);
  }

  /** setTimeout bound to the current phase: it never fires after a phase change or dispose. */
  private at(when: number, fn: () => void | Promise<void>): Timer {
    const key = this.phase?.key;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.disposed || this.phase?.key !== key) return;
      try {
        const r = fn();
        if (r instanceof Promise) r.catch((err: unknown) => this.log("timer task failed", err));
      } catch (err) {
        this.log("timer task failed", err);
      }
    }, Math.max(0, when - this.now()));
    this.timers.add(timer);
    return timer;
  }

  private cancel(timer: Timer | null): void {
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(timer);
  }

  private clearPhase(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.guard = null;
    this.guardFn = null;
    this.phase?.ac.abort();
  }

  /** Never logs chat content: only what happened and why. */
  private log(msg: string, err?: unknown): void {
    const detail = err === undefined ? "" : `: ${errorName(err)}${err instanceof Error && err.message ? ` (${err.message.slice(0, 120)})` : ""}`;
    console.log(`[ai ${this.roomCode}] ${msg}${detail}`);
  }
}
