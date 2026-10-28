// Controller tests: fake game server, fake Part 2, fake Muse, mocked timers.
// No real Muse calls are possible here: the controller only calls deps.call.
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createSessionMemory, fallbackPersona, inferWritingStyle, validateStructuredOutput } from "@game/ai";
import { LIMITS } from "@game/shared";
import type {
  AiActions, Channel, ChatMessage, CurrentRound, FirstQuestionAnswerSnapshot, MuseChatRequest, Persona, Phase,
  PlayerId, RoomView, RoundNumber, RoundRecord, Tier,
} from "@game/shared";
import type { MuseCallFn, MuseCallOptions } from "../muse.js";
import { AiController } from "./AiController.js";
import { classifyMessage, isGroupQuestion, isJustAgreement, mentionsNickname, quotesAnswer, replyProbability } from "./cadence.js";
import {computeSendAt} from "./timing.js";
import { chooseFinalVote, chooseSuspicionVote } from "./decisions.js";
import type { HumannessDeps, PlayerTurnContext, SessionMemory } from "./deps.js";
import { selectRevealNotes, type NoteRecord } from "./notes.js";

// ── fixtures ────────────────────────────────────────────────────────────────

const AI = "ai1";
const PLAYERS = [
  { id: AI, nickname: "Fox", emoji: "🦊" },
  { id: "h1", nickname: "Owl", emoji: "🦉" },
  { id: "h2", nickname: "Panda", emoji: "🐼" },
  { id: "h3", nickname: "Otter", emoji: "🦦" },
];

const SESSION = "gen-1";

const PERSONA: Persona = fallbackPersona();

const FALLBACKS: HumannessDeps["FALLBACK_LINES"] = {
  answer: { light: ["tacos no question"], personal: ["boba with my roommate"] },
  collab: ["we both hate 8ams"],
  group: ["lol wait what"],
  accused: ["bro what 💀"],
  pair: ["ok same honestly"],
};

function fakeHumanness(overrides: Partial<HumannessDeps> = {}, built: PlayerTurnContext[] = []): HumannessDeps {
  const build = (mode: string) => (ctx: PlayerTurnContext): MuseChatRequest => {
    built.push(ctx);
    return { messages: [{ role: "user", content: mode }] };
  };
  return {
    buildAnswerRequest: build("answer"),
    buildGroupChatRequest: build("group"),
    buildPairChatRequest: build("pair"),
    buildCollabRequest: build("collab"),
    computeStyleProfile: () => ({
      medianChars: 40, lowercaseStartRatio: 0.7, endsWithPeriodRatio: 0.1,
      emojiPerMessage: 0.2, commonTokens: [], sampleMessages: [],
    }),
    inferWritingStyle,
    validateStructuredOutput,
    FALLBACK_LINES: FALLBACKS,
    ...overrides,
  };
}

type MuseMode = "ok" | "fail" | "hang" | "invalid" | "skip";
interface MuseLog { mode: string; opts: MuseCallOptions }

/** Fake museCall. "hang" settles only when the controller aborts it. */
function fakeMuse(mode: MuseMode, calls: MuseLog[], delayMs = 1_500): MuseCallFn {
  const aborted = () => Object.assign(new Error("aborted"), { name: "AbortedError" });
  return (async (req: MuseChatRequest, opts: MuseCallOptions = {}) => {
    const kind = req.messages[0]!.content;
    calls.push({ mode: kind, opts });
    if (mode === "fail") throw Object.assign(new Error("no key"), { name: "MuseUnavailableError" });
    await new Promise<void>((resolve, reject) => {
      opts.signal?.addEventListener("abort", () => reject(aborted()), { once: true });
      if (mode !== "hang") setTimeout(resolve, delayMs);
    });
    const text = mode === "invalid" ? "as an AI I cannot do that" : `${kind} text`;
    if (kind === "answer") return { answer: text, note: `${kind} note` };
    if (kind === "collab") return { result: text, note: "collab note" };
    if (mode === "skip") return { action: "skip", message: "", note: "" };
    return { action: "send", message: text, note: `${kind} note` };
  }) as MuseCallFn;
}

/** Deterministic PRNG for repeatable "random" behavior. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function currentRound(n: RoundNumber, tier: Tier): CurrentRound {
  return { number: n, tier, promptId: `Q${n}`, prompt: "question?", submitPrompt: tier === "collab" ? "one thing in common" : null };
}

function record(n: RoundNumber, tier: Tier, voteCounts: Record<PlayerId, number> | null): RoundRecord {
  return { round: n, tier, promptId: `Q${n}`, prompt: "question?", answers: [], voteCounts };
}

interface ActionLog { type: string; at: number; args: unknown[] }

class FakeGame {
  readonly view: RoomView;
  readonly actions: ActionLog[] = [];
  readonly ai: AiController;
  private msgSeq = 0;

  constructor(opts: { muse?: MuseCallFn; random?: () => number; humanness?: HumannessDeps } = {}) {
    this.view = {
      code: "TEST", serverNow: Date.now(), phase: "lobby", phaseEndsAt: null,
      me: {
        id: AI, realName: "", nickname: "Fox", emoji: "🦊", isHost: false, myAnswer: null, myVote: null,
        myPairId: null, myCollabResult: null, myVouches: {}, partnerCard: null,
      },
      lobby: null, players: PLAYERS, round: null, history: [], answerProgress: null, messages: [],
      voteProgress: null, lastVoteCounts: null, pairs: null, collabResults: null, vouches: null, reveal: null,
    };
    const log = (type: string, ...args: unknown[]) => this.actions.push({ type, at: Date.now(), args });
    const actions: AiActions = {
      submitAnswer: (text) => (log("answer", text), { ok: true }),
      sendChat: (text, channel) => {
        log("chat", text, channel);
        const msg = this.message(AI, text, channel, Date.now());
        this.deliver(msg);
        return { ok: true, messageId: msg.id, visibleAt: msg.at };
      },
      castVote: (targetId) => (log("vote", targetId), { ok: true }),
      submitCollab: (text) => (log("collab", text), { ok: true }),
      setVouch: (targetId, vouched) => (log("vouch", targetId, vouched), { ok: true }),
    };
    this.ai = new AiController(
      { sessionGeneration: SESSION, roomCode: "TEST", aiPlayerId: AI, persona: PERSONA, actions },
      { humanness: opts.humanness ?? fakeHumanness(), call: opts.muse ?? fakeMuse("ok", []), random: opts.random },
    );
  }

  snapshot(): RoomView {
    return { ...this.view, serverNow: Date.now(), messages: [...this.view.messages] };
  }

  enter(phase: Phase, round: RoundNumber | null, durationMs: number | null, patch: Partial<RoomView> = {}): void {
    Object.assign(this.view, { phase, phaseEndsAt: durationMs == null ? null : Date.now() + durationMs, ...patch });
    this.ai.onEvent({ type: "phaseChanged", phase, round }, this.snapshot());
  }

  update(patch: Partial<RoomView>): void {
    Object.assign(this.view, patch);
    this.ai.onEvent({ type: "stateUpdated" }, this.snapshot());
  }

  private message(from: PlayerId, text: string, channel: Channel, at: number): ChatMessage {
    return { id: `m${++this.msgSeq}`, channel, pairId: channel === "pair" ? this.view.me!.myPairId : null, from, text, at };
  }

  deliver(msg: ChatMessage): void {
    this.view.messages.push(msg);
    this.ai.onEvent({ type: "messageVisible", message: msg }, this.snapshot());
  }

  humanSays(from: PlayerId, text: string, channel: Channel = "group"): ChatMessage {
    const msg = this.message(from, text, channel, Date.now());
    this.deliver(msg);
    return msg;
  }

  /** The server's private round-1 snapshot: the first `submitted` humans have answered. */
  firstAnswers(submitted: number, revision: number, sessionGeneration = SESSION): void {
    const humans = PLAYERS.filter((p) => p.id !== AI);
    const answers = humans.slice(0, submitted).map((p) => ({ playerId: p.id, nickname: p.nickname, text: `${p.nickname} answer` }));
    const snapshot: FirstQuestionAnswerSnapshot = {
      sessionGeneration, round: 1, promptId: "Q1", question: "question?", revision,
      humanPlayerIds: humans.map((p) => p.id), submittedCount: answers.length, answers,
    };
    this.ai.onEvent({ type: "firstQuestionAnswersUpdated", snapshot }, this.snapshot());
  }

  of(type: string): ActionLog[] {
    return this.actions.filter((a) => a.type === type);
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r));
}

/** Advance the mocked clock in small steps, letting promise chains run in between. */
async function advance(ms: number, step = 100): Promise<void> {
  for (let t = 0; t < ms; t += step) {
    mock.timers.tick(Math.min(step, ms - t));
    await flush();
  }
}

const low = () => 0.01; // every roll succeeds, every uniform() sits at its low end

// ── pure helpers ────────────────────────────────────────────────────────────

describe("cadence helpers", () => {
  test("nickname mentions respect word boundaries", () => {
    assert.ok(mentionsNickname("fox are you real", "Fox"));
    assert.ok(mentionsNickname("ok @Fox lol", "Fox"));
    assert.ok(mentionsNickname("FOX?", "Fox"));
    assert.ok(mentionsNickname("Bee's answer was wild", "Bee"));
    assert.ok(!mentionsNickname("foxes are cute", "Fox"));
    assert.ok(!mentionsNickname("i've been up since 6", "Bee"));
  });

  test("quoting our answer counts as addressed", () => {
    const answers = ["breakfast tacos from tacodeli every time"];
    assert.ok(quotesAnswer("who said tacodeli every time lmao", answers));
    assert.ok(!quotesAnswer("tacos are good", answers));
  });

  test("accusations need a mention plus a bot word", () => {
    assert.deepEqual(classifyMessage("Fox is def the AI", "Fox", []), { addressed: true, accused: true });
    assert.deepEqual(classifyMessage("fox whats ur major", "Fox", []), { addressed: true, accused: false });
    assert.deepEqual(classifyMessage("someone here is a bot", "Fox", []), { addressed: false, accused: false });
  });

  test("ordinary reply probability tracks the median human and clamps", () => {
    assert.equal(replyProbability(0, 0), 0.25);
    assert.ok(Math.abs(replyProbability(2, 0) - 0.55) < 1e-9);
    assert.equal(replyProbability(5, 0), 0.6);
    assert.equal(replyProbability(0, 3), 0.05);
  });

  test("questions to the whole group are recognized", () => {
    assert.ok(isGroupQuestion("ok what does everyone actually pick tho?"));
    assert.ok(isGroupQuestion("anyone else been to tacodeli?"));
    assert.ok(isGroupQuestion("which one are yall picking"));
    assert.ok(!isGroupQuestion("everyone picked tacos lol"), "not a question");
    assert.ok(!isGroupQuestion("which spot tho?"), "a question, but not to the group");
  });

  test("bare agreement is recognized; pushback and questions aren't", () => {
    for (const t of ["same tbh", "thats so real", "fr fr", "yeah same lol", "That's true"]) assert.ok(isJustAgreement(t), t);
    for (const t of ["nah tacodeli is overrated", "same but bowling is better", "why that one", "real?", ""]) assert.ok(!isJustAgreement(t), t);
  });

  test("even maximum-length chat adds less than 10 seconds of simulated delay",()=>{
    assert.ok(computeSendAt(0,LIMITS.chatMaxChars,()=>0.999)<10_000);
  });
});

describe("vote decisions", () => {
  const humans = ["h1", "h2", "h3"];
  const history = [record(1, "light", { h1: 1, h2: 3, [AI]: 1 }), record(2, "personal", null)];

  test("suspicion vote bandwagons on the most-voted human", () => {
    assert.deepEqual(chooseSuspicionVote(humans, history, low), { targetId: "h2", reason: "top" });
  });

  test("round 1 has no votes yet, so it votes randomly", () => {
    assert.equal(chooseSuspicionVote(humans, [], low)?.reason, "random");
  });

  test("final vote skips our partner even if they're the top suspect", () => {
    assert.deepEqual(chooseFinalVote(humans, new Set(["h2"]), history, low), { targetId: "h1", reason: "top" });
  });
});

describe("reveal notes", () => {
  test("at most 6, each ≤120 chars, priority picks first, story order", () => {
    let seq = 0;
    const n = (kind: NoteRecord["kind"], round: RoundNumber | null, text: string, accused = false): NoteRecord =>
      ({ kind, round, text, accused, seq: ++seq });
    const notes = [
      n("answer", 1, "said tacos bc 3 people already did"),
      n("vote", 1, "voted Owl at random"),
      n("discuss", 1, "short"),
      n("discuss", 1, "got called the bot and said i'd been up since 6, nobody pushed back", true),
      n("answer", 2, "x".repeat(300)),
      n("pairOpener", 3, "opened with the food question"),
      n("pair", 3, "asked about their major"),
      n("collab", 3, "said we both hate 8ams"),
      n("vouch", 3, "vouched for Panda, felt rude not to"),
      n("finalVote", 3, "final vote on Owl"),
    ];
    const out = selectRevealNotes(notes);
    assert.equal(out.length, 6);
    assert.ok(out.every((o) => o.text.length <= 120));
    const texts = out.map((o) => o.text);
    assert.ok(texts.includes("said tacos bc 3 people already did"));
    assert.ok(texts.some((t) => t.startsWith("got called the bot")));
    assert.ok(!texts.includes("short"));
    assert.ok(texts.includes("final vote on Owl"));
  });
});

// ── the controller ──────────────────────────────────────────────────────────

describe("AiController", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 }));
  afterEach(() => mock.timers.reset());

  test("answer (round 2+): model answer submitted within 35–85% of the phase, with timeout, signal and room", async () => {
    const calls: MuseLog[] = [];
    const game = new FakeGame({ muse: fakeMuse("ok", calls), random: mulberry32(1) });
    const start = Date.now();
    game.enter("answer", 2, 30_000, { round: currentRound(2, "personal"), answerProgress: { answered: 0, total: 4 } });
    await advance(30_000);
    const [answer, ...extra] = game.of("answer");
    assert.equal(extra.length, 0);
    assert.equal(answer!.args[0], "answer text");
    assert.ok(answer!.at - start >= 10_500 && answer!.at - start <= 25_600, `submitted at ${answer!.at - start}ms`);
    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.opts.timeoutMs! <= 12_000);
    assert.ok(calls[0]!.opts.signal instanceof AbortSignal);
    assert.equal(calls[0]!.opts.roomCode, "TEST");
  });

  test("answer (round 2+): submits 2–5s after every human has answered", async () => {
    const game = new FakeGame({ random: mulberry32(2) });
    const start = Date.now();
    game.enter("answer", 2, 30_000, { round: currentRound(2, "personal"), answerProgress: { answered: 0, total: 4 } });
    await advance(3_000);
    game.update({ answerProgress: { answered: 3, total: 4 } });
    await advance(10_000);
    const answer = game.of("answer")[0]!;
    assert.ok(answer.at - start >= 5_000 && answer.at - start <= 8_100, `submitted at ${answer.at - start}ms`);
  });

  test("answer: a failed Muse call falls back at the planned slot (personal tier)", async () => {
    const game = new FakeGame({ muse: fakeMuse("fail", []), random: mulberry32(3) });
    const start = Date.now();
    game.enter("answer", 2, 30_000, { round: currentRound(2, "personal"), answerProgress: { answered: 0, total: 4 } });
    await advance(30_000);
    const answer = game.of("answer")[0]!;
    assert.equal(answer.args[0], "boba with my roommate");
    assert.ok(answer.at - start >= 10_500 && answer.at - start <= 25_600);
  });

  test("answer: a stuck call hits the deadline guard at end−3s", async () => {
    const game = new FakeGame({ muse: fakeMuse("hang", []), random: mulberry32(4) });
    const start = Date.now();
    game.enter("answer", 1, 30_000, { round: currentRound(1, "light"), answerProgress: { answered: 0, total: 4 } });
    await advance(30_000);
    const answer = game.of("answer")[0]!;
    assert.equal(answer.args[0], "tacos no question");
    assert.ok(Math.abs(answer.at - start - 27_000) <= 100, `submitted at ${answer.at - start}ms`);
  });

  test("answer: invalid output is regenerated once, then falls back", async () => {
    const calls: MuseLog[] = [];
    const game = new FakeGame({ muse: fakeMuse("invalid", calls), random: mulberry32(5) });
    game.enter("answer", 1, 30_000, { round: currentRound(1, "light"), answerProgress: { answered: 0, total: 4 } });
    await advance(30_000);
    assert.equal(calls.length, 2);
    assert.equal(game.of("answer")[0]!.args[0], "tacos no question");
  });

  test("discuss: replies retain a brief read/type delay and never send in the last 4s", async () => {
    let replies = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const game = new FakeGame({ random: mulberry32(seed) });
      const start = Date.now();
      game.enter("discuss", 1, 45_000, { round: currentRound(1, "light") });
      await advance(1_000);
      const trigger = game.humanSays("h1", "fox r u even real");
      await advance(44_000);
      const chats = game.of("chat");
      for (const c of chats) {
        assert.ok(c.at - trigger.at >= 1_500, `seed ${seed}: visible ${c.at - trigger.at}ms after trigger`);
        assert.ok(start + 45_000 - c.at >= 4_000, `seed ${seed}: sent with ${start + 45_000 - c.at}ms left`);
      }
      if (chats.some((c) => c.args[0] === "group text")) replies++;
      game.ai.dispose();
    }
    assert.ok(replies >= 12, `only ${replies}/20 games replied to a direct question`);
  });

  test("discuss: an API failure never substitutes a canned deflection for a defense", async () => {
    const game = new FakeGame({ muse: fakeMuse("fail", []), random: low });
    game.enter("discuss", 1, 45_000, { round: currentRound(1, "light") });
    await advance(1_000);
    game.humanSays("h1", "Fox is def the AI");
    await advance(44_000);
    assert.equal(game.of("chat").length, 0);
  });

  test("discuss: on Muse failure, unaddressed messages and openers stay quiet", async () => {
    const game = new FakeGame({ muse: fakeMuse("fail", []), random: low });
    game.enter("discuss", 1, 45_000, { round: currentRound(1, "light") });
    await advance(1_000);
    game.humanSays("h1", "anyone else running on no sleep");
    await advance(44_000);
    assert.equal(game.of("chat").length, 0);
  });

  test("discuss: a burst of direct questions gets one collective reply", async () => {
    const calls: MuseLog[] = [],built:PlayerTurnContext[]=[];
    const game = new FakeGame({ muse: fakeMuse("ok", calls, 500), humanness:fakeHumanness({},built), random: low });
    game.enter("discuss", 1, 45_000, { round: currentRound(1, "light") });
    await advance(1_000);
    game.humanSays("h1", "fox whats ur major");
    await advance(200);
    game.humanSays("h2", "@fox and where are u from");
    await advance(43_800);
    assert.equal(game.of("chat").length,1);
    assert.equal(calls.length,1);
    assert.equal(built[0]!.view.messages.filter(m=>m.from!==AI).length,2);
  });

  test("discuss: compliments and trust statements do not start calls or thank-you replies",async()=>{
    const calls:MuseLog[]=[];
    const game=new FakeGame({muse:fakeMuse("ok",calls),random:low});
    game.enter("discuss",1,45_000,{round:currentRound(1,"light")});
    game.humanSays("h1","nice answer Fox");game.humanSays("h2","I trust Fox");
    await advance(44_000);
    assert.equal(calls.length,0);assert.equal(game.of("chat").length,0);
  });

  test("discuss: a nickname mention without a question may be skipped",async()=>{
    const calls:MuseLog[]=[],built:PlayerTurnContext[]=[];
    const game=new FakeGame({muse:fakeMuse("skip",calls,500),humanness:fakeHumanness({},built),random:low});
    game.enter("discuss",1,45_000,{round:currentRound(1,"light")});
    game.humanSays("h1","Fox that was a pretty good answer");await advance(10_000);
    assert.equal(calls.length,1);assert.equal(built[0]!.addressedToMe,false);assert.equal(game.of("chat").length,0);
  });

  test("discuss: a direct accusation is selected even when a normal reply roll would fail",async()=>{
    const calls:MuseLog[]=[];
    const game=new FakeGame({muse:fakeMuse("ok",calls,500),random:()=>0.99});
    game.enter("discuss",1,45_000,{round:currentRound(1,"light")});
    game.humanSays("h1","Fox that sounds robotic");await advance(10_000);
    assert.equal(calls.length,1);assert.equal(game.of("chat").length,1);
  });

  test("discuss: a resolved accusation does not receive a late defense or acknowledgement",async()=>{
    const calls:MuseLog[]=[];
    const game=new FakeGame({muse:fakeMuse("ok",calls),random:low});
    game.enter("discuss",1,45_000,{round:currentRound(1,"light")});
    game.humanSays("h1","Fox is the bot");await advance(1200);
    assert.equal(calls.length,1);
    game.humanSays("h1","ok that makes sense");await advance(10_000);
    assert.equal(calls.length,1);assert.equal(game.of("chat").length,0);
  });

  test("discuss: a question arriving during generation refreshes the draft into one reply",async()=>{
    const calls:MuseLog[] = [],built:PlayerTurnContext[]=[];
    const game=new FakeGame({muse:fakeMuse("ok",calls),humanness:fakeHumanness({},built),random:low});
    game.enter("discuss",1,45_000,{round:currentRound(1,"light")});
    game.humanSays("h1","Fox why did you pick that answer?");
    await advance(1200);assert.equal(calls.length,1);
    game.humanSays("h2","Fox and what did you mean about your shift?");
    await advance(10_000);
    assert.equal(calls.length,2);assert.equal(game.of("chat").length,1);
    assert.ok(built[1]!.view.messages.some(m=>m.text.includes("your shift")));
  });

  test("discuss: separate later replies keep the 8s send gap",async()=>{
    const game=new FakeGame({muse:fakeMuse("ok",[],500),random:low});
    game.enter("discuss",1,45_000,{round:currentRound(1,"light")});
    game.humanSays("h1","Fox what do you do after class?");await advance(4000);
    game.humanSays("h2","Fox where do you work?");await advance(12_000);
    const times=game.of("chat").map(c=>c.at);assert.equal(times.length,2);
    assert.ok(times[1]!-times[0]!>=8000);
  });

  test("discuss: nothing is sent with less than 4s left", async () => {
    const game = new FakeGame({ muse: fakeMuse("ok", [], 500), random: low });
    game.enter("discuss", 1, 8_000, { round: currentRound(1, "light") });
    await advance(4500);
    game.humanSays("h1", "fox??");
    await advance(3500);
    assert.equal(game.of("chat").length, 0);
  });

  test("vote: bandwagons, never votes for itself, and casts 1–3s after every human voted", async () => {
    const game = new FakeGame({ random: low });
    const start = Date.now();
    game.enter("vote", 2, 12_000, {
      round: currentRound(2, "personal"),
      history: [record(1, "light", { h1: 1, h2: 2, [AI]: 1 }), record(2, "personal", null)],
      voteProgress: { voted: 0, total: 4 },
    });
    await advance(500);
    game.update({ voteProgress: { voted: 3, total: 4 } });
    await advance(11_500);
    const [vote, ...extra] = game.of("vote");
    assert.equal(extra.length, 0);
    assert.equal(vote!.args[0], "h2");
    assert.ok(vote!.at - start >= 1_500 && vote!.at - start <= 3_600, `cast at ${vote!.at - start}ms`);
  });

  test("vote: random seeds never self-vote", async () => {
    for (let seed = 1; seed <= 30; seed++) {
      const game = new FakeGame({ random: mulberry32(seed) });
      game.enter("vote", 1, 12_000, { round: currentRound(1, "light"), history: [record(1, "light", null)], voteProgress: { voted: 0, total: 4 } });
      await advance(12_000, 500);
      const votes = game.of("vote");
      assert.equal(votes.length, 1);
      assert.notEqual(votes[0]!.args[0], AI);
    }
  });

  test("pairChat → pairResults → finalVote: replies to the partner, submits a collab, vouches, final-votes a non-partner", async () => {
    const game = new FakeGame({ random: low });
    game.view.me!.myPairId = "p1";
    const pairs = [{ id: "p1", members: [AI, "h2"] }, { id: "p2", members: ["h1", "h3"] }];
    const history = [record(1, "light", { h2: 3, h1: 1 }), record(2, "personal", { h2: 1 }), record(3, "collab", null)];
    const start = Date.now();
    game.enter("pairChat", 3, 90_000, { round: currentRound(3, "collab"), pairs, history });
    await advance(12_000);
    game.humanSays("h2", "hey whats ur major", "pair");
    await advance(78_000);
    assert.ok(game.of("chat").some((c) => c.args[0] === "pair text" && c.args[1] === "pair"));
    const collab = game.of("collab")[0]!;
    assert.equal(collab.args[0], "collab text");
    assert.ok((collab.args[0] as string).length <= LIMITS.collabMaxChars);
    assert.ok(collab.at - start >= 49_500 && collab.at - start <= 78_000, `collab at ${collab.at - start}ms`);

    const vouchStart = Date.now();
    game.enter("pairResults", 3, 20_000);
    await advance(20_000);
    const vouch = game.of("vouch")[0]!;
    assert.deepEqual(vouch.args, ["h2", true]);
    assert.ok(vouch.at - vouchStart >= 6_000 && vouch.at - vouchStart <= 14_000);

    game.enter("finalVote", 3, 15_000, { voteProgress: { voted: 0, total: 4 } });
    await advance(15_000);
    assert.deepEqual(game.of("vote")[0]!.args, ["h1"]);

    const info = game.ai.getRevealInfo();
    assert.deepEqual(info.persona, { name: "Fox", blurb: PERSONA.blurb }, "the reveal shows the AI's nickname");
    assert.ok(info.notes.length >= 3 && info.notes.length <= 6);
    assert.ok(info.notes.every((n) => n.text.length <= 120));
  });

  test("pairChat: a stuck collab call falls back at the deadline guard", async () => {
    const game = new FakeGame({ muse: fakeMuse("hang", []), random: low });
    game.view.me!.myPairId = "p1";
    const start = Date.now();
    game.enter("pairChat", 3, 90_000, { round: currentRound(3, "collab"), pairs: [{ id: "p1", members: [AI, "h2"] }] });
    await advance(90_000, 500);
    const collab = game.of("collab")[0]!;
    assert.equal(collab.args[0], "we both hate 8ams");
    assert.ok(Math.abs(collab.at - start - 87_000) <= 500);
  });

  test("a phase change aborts the previous phase's call and its pending actions", async () => {
    const calls: MuseLog[] = [];
    const game = new FakeGame({ muse: fakeMuse("hang", calls), random: mulberry32(9) });
    game.enter("answer", 2, 30_000, { round: currentRound(2, "personal"), answerProgress: { answered: 0, total: 4 } });
    await advance(1_000);
    game.enter("discuss", 1, 45_000);
    await advance(100);
    assert.equal(calls[0]!.opts.signal!.aborted, true);
    await advance(30_000);
    assert.equal(game.of("answer").length, 0);
  });

  test("dispose cancels every timer and aborts in-flight calls", async () => {
    const calls: MuseLog[] = [];
    const game = new FakeGame({ muse: fakeMuse("hang", calls), random: mulberry32(10) });
    game.enter("answer", 2, 30_000, { round: currentRound(2, "personal"), answerProgress: { answered: 0, total: 4 } });
    await advance(1_000);
    game.ai.dispose();
    assert.equal(calls[0]!.opts.signal!.aborted, true);
    game.update({ answerProgress: { answered: 3, total: 4 } });
    await advance(60_000, 1_000);
    assert.equal(game.actions.length, 0);
  });

  test("onEvent never throws, even when Part 2 code throws", async () => {
    const humanness = fakeHumanness({ computeStyleProfile: () => { throw new Error("bug in style"); } });
    const game = new FakeGame({ humanness, random: mulberry32(11) });
    game.enter("answer", 1, 30_000, { round: currentRound(1, "light"), answerProgress: { answered: 0, total: 4 } });
    await advance(30_000);
    assert.equal(game.of("answer")[0]!.args[0], "tacos no question");
    assert.doesNotThrow(() => game.ai.onEvent({ type: "stateUpdated" }, {} as RoomView));
    assert.doesNotThrow(() => game.ai.onEvent({ type: "phaseChanged", phase: "discuss", round: 1 }, null as unknown as RoomView));
  });

  test("round 1: waits for every human's answer, builds from them, submits as soon as it's ready", async () => {
    const calls: MuseLog[] = [];
    const built: PlayerTurnContext[] = [];
    const game = new FakeGame({ muse: fakeMuse("ok", calls), humanness: fakeHumanness({}, built), random: mulberry32(12) });
    const start = Date.now();
    game.enter("answer", 1, 30_000, { round: currentRound(1, "light"), answerProgress: { answered: 0, total: 4 } });
    game.firstAnswers(0, 0);
    await advance(3_000);
    game.firstAnswers(2, 2);
    await advance(1_000);
    assert.equal(calls.length, 0, "no generation until every human has answered");
    game.firstAnswers(3, 3);
    await advance(3_000);
    const answer = game.of("answer")[0]!;
    assert.equal(answer.args[0], "answer text");
    assert.ok(answer.at - start >= 5_500 && answer.at - start <= 5_700, `submitted at ${answer.at - start}ms`);
    assert.equal(built[0]!.firstQuestionHumanAnswers?.submittedCount, 3);
    assert.equal(built[0]!.firstQuestionDeadlineException, false);
    assert.equal(typeof calls[0]!.opts.deadlineAtMs, "number");
  });

  test("round 1: without every answer, it generates at the reserve deadline from what it has", async () => {
    const calls: MuseLog[] = [];
    const built: PlayerTurnContext[] = [];
    const game = new FakeGame({ muse: fakeMuse("ok", calls), humanness: fakeHumanness({}, built), random: mulberry32(13) });
    const start = Date.now();
    game.enter("answer", 1, 30_000, { round: currentRound(1, "light"), answerProgress: { answered: 0, total: 4 } });
    game.firstAnswers(2, 1);
    await advance(30_000);
    assert.equal(calls.length, 1);
    const at = game.of("answer")[0]!.at - start;
    assert.ok(Math.abs(at - 22_500) <= 200, `submitted at ${at}ms (reserve at end−9s, then 1.5s of generation)`);
    assert.equal(built[0]!.firstQuestionDeadlineException, true);
    assert.equal(built[0]!.firstQuestionHumanAnswers?.submittedCount, 2);
  });

  test("round 1: a snapshot from another game is ignored", async () => {
    const calls: MuseLog[] = [];
    const game = new FakeGame({ muse: fakeMuse("ok", calls), random: mulberry32(14) });
    game.enter("answer", 1, 30_000, { round: currentRound(1, "light"), answerProgress: { answered: 0, total: 4 } });
    game.firstAnswers(3, 1, "previous-game");
    await advance(5_000);
    assert.equal(calls.length, 0);
  });

  test("a turn addressed to the AI can't be skipped: regenerated once, then a fallback line", async () => {
    const calls: MuseLog[] = [];
    const game = new FakeGame({ muse: fakeMuse("skip", calls, 500), random: low });
    game.enter("discuss", 1, 45_000, { round: currentRound(1, "light") });
    await advance(1_000);
    game.humanSays("h1", "fox whats your major");
    await advance(44_000);
    assert.deepEqual(game.of("chat").map((c) => c.args), [["lol wait what", "group"]], "the unaddressed opener may skip");
    assert.equal(calls.filter((c) => c.mode === "group").length, 2, "regenerate the direct reply once, without an unrelated opener");
  });

  test("Part 2 memory: created per game, kept in sync, passed to builders, records accepted output, disposed", async () => {
    const log: string[] = [];
    const memory = createSessionMemory(SESSION, PLAYERS);
    const built: PlayerTurnContext[] = [];
    const humanness = fakeHumanness(
      {
        createSessionMemory: (gen, roster) => (log.push(`create ${gen} ${roster.length}`), memory),
        updateSessionMemory: (m) => (log.push("update"), m),
        recordAcceptedOutput: (_m, ack, out) => (log.push(`record ${out.mode} ${out.text} ${ack.ok}`), true),
        disposeSessionMemory: () => void log.push("dispose"),
      },
      built,
    );
    const game = new FakeGame({ humanness, random: mulberry32(15) });
    game.enter("answer", 2, 30_000, { round: currentRound(2, "personal"), answerProgress: { answered: 0, total: 4 } });
    await advance(30_000);
    game.ai.dispose();
    assert.equal(log[0], `create ${SESSION} 4`);
    assert.ok(log.includes("update"));
    assert.ok(log.includes("record answer answer text true"));
    assert.equal(log.at(-1), "dispose");
    assert.equal(built[0]!.memory, memory);
  });

  // random 0.5: passes the 85% "aimed at us" roll, fails the ~25–40% ordinary roll and the 45% opener.
  const mid = () => 0.5;

  test("discuss: a question to the whole group is answered like a direct question", async () => {
    const calls: MuseLog[] = [], built: PlayerTurnContext[] = [];
    const game = new FakeGame({ muse: fakeMuse("ok", calls, 500), humanness: fakeHumanness({}, built), random: mid });
    game.enter("discuss", 1, 45_000, { round: currentRound(1, "light") });
    game.humanSays("h1", "ok what does everyone actually pick tho?");
    await advance(12_000);
    assert.equal(calls.length, 1);
    assert.equal(built[0]!.addressedToMe, true);
    assert.equal(game.of("chat").length, 1);
  });

  test("discuss: a reply right after the AI's own message counts as aimed at it", async () => {
    const calls: MuseLog[] = [];
    const game = new FakeGame({ muse: fakeMuse("ok", calls, 500), random: mid });
    game.enter("discuss", 1, 45_000, { round: currentRound(1, "light") });
    game.humanSays("h1", "ok what does everyone actually pick tho?");
    await advance(6_000);
    assert.equal(game.of("chat").length, 1, "the AI answered the group question");
    game.humanSays("h2", "nah tacodeli is overrated");
    await advance(20_000);
    assert.equal(calls.length, 2);
    assert.equal(game.of("chat").length, 2, "and replied to the reply");
  });

  test("discuss: bare agreement right after the AI's message doesn't force a reply", async () => {
    const calls: MuseLog[] = [];
    const game = new FakeGame({ muse: fakeMuse("ok", calls, 500), random: mid });
    game.enter("discuss", 1, 45_000, { round: currentRound(1, "light") });
    game.humanSays("h1", "ok what does everyone actually pick tho?");
    await advance(6_000);
    assert.equal(game.of("chat").length, 1);
    game.humanSays("h2", "same tbh");
    await advance(20_000);
    assert.equal(calls.length, 1, "no Muse call: it only gets the ordinary roll, which fails at 0.5");
    assert.equal(game.of("chat").length, 1);
  });

  test("discuss: an answer to a direct question isn't thrown away when the chat moves on", async () => {
    const calls: MuseLog[] = [];
    const game = new FakeGame({ muse: fakeMuse("ok", calls), random: mid });
    game.enter("discuss", 1, 45_000, { round: currentRound(1, "light") });
    game.humanSays("h1", "Fox why tacos tho?");
    await advance(1_000);
    game.humanSays("h2", "bowling is so mid");
    game.humanSays("h3", "nah bowling slaps");
    game.humanSays("h2", "karaoke is the actual move");
    await advance(12_000);
    assert.equal(calls.length, 1, "no second Muse call to redraft");
    assert.equal(game.of("chat").length, 1);
  });
});
