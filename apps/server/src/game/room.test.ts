import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, ROOM_TTL_MS, type PlayerId } from "@game/shared";
import { advance } from "./phases.js";
import type { Room } from "./Room.js";
import { RoomRegistry } from "./rooms.js";
import { flush, makeRoom, sleep, validMatch, TEST_PERSONA } from "./testkit.js";

process.env.CHAT_DELAY_MS = "40";
delete process.env.TIMER_SCALE;

const open: Room[] = [];
function setup(opts: Parameters<typeof makeRoom>[0] = {}) {
  const t = makeRoom(opts);
  open.push(t.room);
  return t;
}
afterEach(() => {
  for (const r of open.splice(0)) r.close("test over");
});

describe("lobby", () => {
  test("names are trimmed and length-checked", () => {
    const { room } = setup({ humans: 1 });
    assert.equal(room.addHuman("   ", false).ok, false);
    assert.equal(room.addHuman("x".repeat(LIMITS.realNameMaxChars + 1), false).ok, false);
    const r = room.addHuman("  Maya  ", false);
    assert.ok(r.ok);
    assert.equal(room.seat(r.playerId)!.realName, "Maya");
  });

  test("room is capped at maxHumans", () => {
    const { room } = setup({ humans: LIMITS.maxHumans });
    assert.deepEqual(room.addHuman("Extra", false), { ok: false, error: "This room is full." });
  });

  test("start needs the host and >= minHumans", async () => {
    const small = setup({ humans: LIMITS.minHumans - 1 });
    assert.equal((await small.room.start(small.host.id)).ok, false);
    const { room, humans, host } = setup({ humans: 3 });
    assert.equal((await room.start(humans[1]!.id)).ok, false, "non-host");
    assert.ok((await room.start(host.id)).ok);
    assert.equal(room.phase, "answer");
    assert.equal((await room.start(host.id)).ok, false, "second start");
  });

  test("no joining after start, and none while start is in progress", async () => {
    let release!: () => void;
    const { room, host } = setup({ humans: 3, persona: () => new Promise((r) => (release = () => r(TEST_PERSONA))) });
    const starting = room.start(host.id);
    await flush();
    assert.equal(room.addHuman("Sneaky", false).ok, false, "join during start");
    assert.equal((await Promise.race([room.start(host.id), sleep(20).then(() => null)]))?.ok, false, "double start");
    release();
    assert.ok((await starting).ok);
    assert.equal(room.addHuman("Late", false).ok, false);
  });

  test("start adds one AI seat, gives everyone a unique nickname, sends gameStarted then phaseChanged", async () => {
    const { room, fake, start } = setup({ humans: 4 });
    await start();
    assert.equal(room.seats.length, 5);
    assert.equal(room.seats.filter((s) => s.isAi).length, 1);
    const nicks = room.seats.map((s) => s.nickname);
    assert.equal(new Set(nicks).size, 5);
    assert.ok(nicks.every(Boolean));
    assert.deepEqual(
      fake.events.slice(0, 2).map((e) => e.type),
      ["gameStarted", "phaseChanged"],
    );
    assert.equal(fake.lastView?.me?.id, room.aiId);
  });

  test("a rejected persona uses the current complete fallback supplier", async () => {
    const { room, fake, start } = setup({ humans: 3, persona: () => Promise.reject(new Error("muse down")) });
    await start();
    assert.deepEqual(fake.init?.persona, TEST_PERSONA);
    assert.equal(room.seat(room.aiId!)!.realName, "", "personas have no name; the AI is known by its nickname");
    assert.ok(fake.init?.sessionGeneration);
  });

  test("legacy persona fields are rejected at game start and replaced with a complete current persona", async () => {
    const { fake, start } = setup({ humans: 3, persona: async () => ({ ...TEST_PERSONA, style: { casing: "lowercase" } }) });
    await start();
    assert.deepEqual(fake.init?.persona, TEST_PERSONA);
    assert.equal("style" in fake.init!.persona, false);
    assert.equal("name" in fake.init!.persona, false);
    assert.ok(fake.init!.persona.facts.length >= 8);
  });

  test("round 1 sends the AI a private snapshot of human answers, never in any view", async () => {
    const { room, humans, fake, sent, start } = setup({ humans: 3 });
    await start();
    await flush();
    const snapshots = () =>
      fake.events.flatMap((e) => (e.type === "firstQuestionAnswersUpdated" ? [e.snapshot] : []));
    assert.equal(snapshots().length, 1, "initial snapshot when round 1 opens");
    assert.deepEqual([snapshots()[0]!.revision, snapshots()[0]!.submittedCount], [0, 0]);

    assert.ok(room.submitAnswer(humans[1]!.id, "tacodeli migas").ok);
    assert.ok(fake.actions!.submitAnswer("ai answer").ok);
    await flush();
    const last = snapshots().at(-1)!;
    assert.equal(snapshots().length, 2, "a human submission updates it; the AI's own does not");
    assert.equal(last.revision, 1);
    assert.equal(last.sessionGeneration, fake.init!.sessionGeneration);
    assert.deepEqual(last.answers.map((a) => a.text), ["tacodeli migas"]);
    assert.ok(!last.humanPlayerIds.includes(room.aiId!));
    assert.equal(last.humanPlayerIds.length, 3);
    const othersViews = [...sent].filter(([socket]) => socket !== humans[1]!.socket).map(([, views]) => views);
    assert.ok(othersViews.length > 0, "other players received views");
    assert.ok(!JSON.stringify(othersViews).includes("tacodeli migas"), "only its author sees an answer during answer");
  });
});

describe("answer phase", () => {
  test("validation, resubmission, wrong phase", async () => {
    const { room, humans, start } = setup();
    const id = humans[1]!.id;
    assert.equal(room.submitAnswer(id, "too early").ok, false, "lobby");
    await start();
    assert.equal(room.submitAnswer(id, "   ").ok, false);
    assert.equal(room.submitAnswer(id, "x".repeat(LIMITS.answerMaxChars + 1)).ok, false);
    assert.ok(room.submitAnswer(id, "first"));
    assert.ok(room.submitAnswer(id, "  second  ").ok);
    assert.equal(room.answers.get(id), "second");
    assert.equal(room.submitAnswer("nobody", "hi").ok, false);
  });

  test("everyone answered (AI included) → phase ends in 2s", async () => {
    const { room, humans, fake, start } = setup({ humans: 3 });
    await start();
    for (const h of humans) room.submitAnswer(h.id, "a");
    assert.ok(room.phaseEndsAt! - Date.now() > 20_000, "AI hasn't answered yet");
    fake.actions!.submitAnswer("ai answer");
    assert.ok(room.phaseEndsAt! - Date.now() <= 2_000);
  });

  test("answers are hidden until discuss, then in seat order with null for missing", async () => {
    const { room, humans, lastView, start, advanceTo } = setup({ humans: 3 });
    await start();
    room.submitAnswer(humans[1]!.id, "secret");
    room.broadcast();
    const v = lastView(humans[2]!.socket)!;
    assert.deepEqual(v.history.at(-1)!.answers, []);
    assert.ok(!JSON.stringify(v).includes("secret"));
    assert.deepEqual(v.answerProgress, { answered: 1, total: 4 });
    await advanceTo("discuss");
    const answers = lastView(humans[2]!.socket)!.history.at(-1)!.answers;
    assert.deepEqual(answers.map((a) => a.playerId), room.seats.map((s) => s.id));
    assert.equal(answers.find((a) => a.playerId === humans[1]!.id)!.text, "secret");
    assert.equal(answers.find((a) => a.playerId === humans[0]!.id)!.text, null);
  });
});

describe("chat", () => {
  test("held for CHAT_DELAY_MS, then visible to everyone; group only in discuss", async () => {
    const { room, humans, lastView, start, advanceTo } = setup({ humans: 3 });
    await start();
    assert.equal(room.sendChat(humans[0]!.id, "hi", "group").ok, false, "answer phase");
    await advanceTo("discuss");
    assert.equal(room.sendChat(humans[0]!.id, "x".repeat(LIMITS.chatMaxChars + 1), "group").ok, false);
    assert.equal(room.sendChat(humans[0]!.id, "hi", "pair").ok, false, "pair chat closed");
    const before = Date.now();
    const r = room.sendChat(humans[0]!.id, "hello all", "group");
    assert.ok(r.ok);
    assert.ok(r.visibleAt - before >= 40 && r.visibleAt - before < 80);
    room.broadcast();
    assert.equal(lastView(humans[0]!.socket)!.messages.length, 0, "not even the sender's copy yet");
    await sleep(70);
    for (const h of humans) assert.equal(lastView(h.socket)!.messages[0]?.text, "hello all");
  });

  test("released even if the phase changed meanwhile, and the AI is told", async () => {
    const { room, humans, fake, start, advanceTo } = setup({ humans: 3 });
    await start();
    await advanceTo("discuss");
    room.sendChat(humans[1]!.id, "last word", "group");
    await advance(room); // → vote
    await sleep(70);
    assert.equal(room.messages.at(-1)?.text, "last word");
    assert.ok(fake.events.some((e) => e.type === "messageVisible" && e.message.text === "last word"));
  });

  test("pair messages only reach that pair (never spectators, never the AI from another pair)", async () => {
    const { room, humans, fake, lastView, start, advanceTo } = setup({ humans: 4 });
    room.addSpectator("screen");
    await start();
    await advanceTo("pairChat");
    // A sender whose pair does NOT contain the AI (4 humans → a pair and a trio with the AI).
    const sender = humans.find((h) => !room.pairOf(h.id)!.members.includes(room.aiId!))!.id;
    const myPair = room.pairOf(sender)!;
    room.sendChat(sender, "psst", "pair");
    await sleep(70);
    await flush();
    for (const h of humans) {
      const sees = lastView(h.socket)!.messages.some((m) => m.text === "psst");
      assert.equal(sees, myPair.members.includes(h.id), h.name);
    }
    assert.ok(!lastView("screen")!.messages.some((m) => m.text === "psst"));
    assert.ok(!fake.events.some((e) => e.type === "messageVisible" && e.message.text === "psst"), "AI told about another pair's message");
    assert.ok(!fake.lastView!.messages.some((m) => m.text === "psst"));

    // A message inside the AI's own trio does reach the AI.
    const trioMate = room.pairOf(room.aiId!)!.members.find((m) => m !== room.aiId)!;
    room.sendChat(trioMate, "hey trio", "pair");
    await sleep(70);
    await flush();
    assert.ok(fake.events.some((e) => e.type === "messageVisible" && e.message.text === "hey trio"));
  });
});

describe("votes", () => {
  test("no self votes, unknown targets or wrong phase; changing is allowed", async () => {
    const { room, humans, start, advanceTo, others } = setup({ humans: 3 });
    const me = humans[0]!.id;
    await start();
    assert.equal(room.castVote(me, others(me)[0]!).ok, false, "answer phase");
    await advanceTo("vote");
    assert.equal(room.castVote(me, me).ok, false);
    assert.equal(room.castVote(me, "ghost").ok, false);
    assert.ok(room.castVote(me, others(me)[0]!).ok);
    assert.ok(room.castVote(me, others(me)[1]!).ok);
    assert.equal(room.votes.get(me), others(me)[1]);
  });

  test("everyone voted → ends in 1.5s; counts land in history; nobody leaves", async () => {
    const { room, humans, fake, start, advanceTo, lastView } = setup({ humans: 3 });
    await start();
    await advanceTo("vote");
    const target = humans[0]!.id;
    for (const h of humans.slice(1)) room.castVote(h.id, target);
    room.castVote(target, humans[1]!.id);
    fake.actions!.castVote(target);
    assert.ok(room.phaseEndsAt! - Date.now() <= 1_500);
    await advance(room);
    const v = lastView(humans[1]!.socket)!;
    assert.equal(v.phase, "voteResult");
    assert.equal(v.lastVoteCounts![target], 3);
    assert.equal(Object.keys(v.lastVoteCounts!).length, 4, "every seat listed, zeros included");
    assert.equal(room.seats.length, 4);
  });

  test("the AI can't cheat: same rules through AiActions", async () => {
    const { room, fake, start, advanceTo } = setup({ humans: 3 });
    await start();
    assert.equal(fake.actions!.castVote(room.humans()[0]!.id).ok, false, "not vote phase");
    assert.equal(fake.actions!.sendChat("hi", "group").ok, false, "not discuss");
    await advanceTo("vote");
    assert.equal(fake.actions!.castVote(room.aiId!).ok, false, "self vote");
  });
});

describe("round 3, reveal, partners", () => {
  async function playToFinalVote(t: ReturnType<typeof setup>) {
    await t.start();
    await t.advanceTo("pairChat");
  }

  test("odd humans: AI pairs with the leftover; collab, vouch and reveal", async () => {
    const t = setup({ humans: 3, matchmaker: async (input) => validMatch(input.humans.map((h) => h.id)) });
    await playToFinalVote(t);
    const { room, humans, fake } = t;
    const aiId = room.aiId!;
    const aiPair = room.pairOf(aiId)!;
    assert.equal(aiPair.members.length, 2);
    const leftover = aiPair.members.find((m) => m !== aiId)!;
    assert.equal(room.currentRound?.number, 3);
    assert.ok(room.currentRound?.submitPrompt);

    assert.equal(room.submitCollab(leftover, "x".repeat(LIMITS.collabMaxChars + 1)).ok, false);
    assert.ok(room.submitCollab(leftover, "we both like naps").ok);
    await t.advanceTo("pairResults");
    assert.equal(room.submitCollab(leftover, "late").ok, false);
    const stranger = humans.find((h) => !aiPair.members.includes(h.id))!.id;
    assert.equal(room.setVouch(leftover, stranger, true).ok, false, "not my partner");
    assert.equal(room.setVouch(leftover, leftover, true).ok, false, "self");
    assert.ok(room.setVouch(leftover, aiId, true).ok);
    fake.actions!.setVouch(leftover, true);
    await t.advanceTo("finalVote");
    assert.equal(room.vouches!.length, 2 + 2, "every member → every partner");
    // Everyone votes for the AI → humans win.
    for (const h of humans) room.castVote(h.id, aiId);
    fake.actions!.castVote(humans[0]!.id);
    await t.advanceTo("reveal");
    const rv = room.reveal!;
    assert.equal(rv.humansWon, true);
    assert.equal(rv.aiPlayerId, aiId);
    assert.deepEqual(Object.keys(rv.realNames).sort(), humans.map((h) => h.id).sort());
    assert.deepEqual(rv.vouchedForAi, [leftover]);
    assert.ok(rv.suspectedBy.every((s) => s.rounds.includes(3)));
    assert.equal(rv.aiPersona.name, room.seat(aiId)!.nickname);

    await t.advanceTo("partners");
    const card = room.partnerCards.get(leftover)!;
    assert.equal(card.kind, "aiPartner");
    assert.equal(card.myCollabResult, "we both like naps");
    assert.ok(card.suggestion && card.suggestion.playerId !== leftover);
    const other = room.partnerCards.get(stranger)!;
    assert.equal(other.kind, "partner");
    assert.equal(other.aiWasInMyPair, false);
    assert.equal(other.partners[0]!.realName, room.seat(other.partners[0]!.playerId)!.realName);
  });

  test("even humans: AI makes a trio; tie in the final vote goes to the AI", async () => {
    const t = setup({ humans: 4 });
    await playToFinalVote(t);
    const { room, humans } = t;
    const aiId = room.aiId!;
    assert.equal(room.pairOf(aiId)!.members.length, 3);
    await t.advanceTo("finalVote");
    // AI 2 votes, one human 2 votes → tie → AI wins.
    const [a, b, c, d] = humans.map((h) => h.id) as [PlayerId, PlayerId, PlayerId, PlayerId];
    room.castVote(a, aiId);
    room.castVote(b, aiId);
    room.castVote(c, d);
    room.castVote(aiId, d);
    await t.advanceTo("reveal");
    assert.equal(room.reveal!.humansWon, false);
    assert.equal(room.reveal!.finalVoteCounts[aiId], 2);
    await t.advanceTo("partners");
    const trio = room.pairOf(aiId)!.members.filter((m) => m !== aiId);
    for (const h of trio) {
      const card = room.partnerCards.get(h)!;
      assert.equal(card.kind, "partner");
      assert.equal(card.aiWasInMyPair, true);
      assert.equal(card.partners.length, 1);
    }
  });

  test("no votes at all → AI wins; mostSuspiciousHuman sums all three votes", async () => {
    const t = setup({ humans: 3 });
    await t.start();
    const { room, humans } = t;
    await t.advanceTo("vote");
    room.castVote(humans[0]!.id, humans[1]!.id);
    room.castVote(humans[2]!.id, humans[1]!.id);
    await t.advanceTo("reveal");
    assert.equal(room.reveal!.humansWon, false);
    assert.deepEqual(room.reveal!.mostSuspiciousHuman, { playerId: humans[1]!.id, totalVotes: 2 });
  });

  test("matchmaker that rejects, returns garbage, or throws synchronously → random valid pairs", async () => {
    const bad = [
      async () => {
        throw new Error("muse down");
      },
      async () => ({ humanPairs: [["nope", "nada"]], leftover: null, sharedThings: [], suggestionForLeftover: null }) as never,
      () => {
        throw new Error("sync throw");
      },
    ];
    for (const matchmaker of bad) {
      const t = setup({ humans: 5, matchmaker: matchmaker as never });
      await playToFinalVote(t);
      const all = t.room.pairs.flatMap((p) => p.members);
      assert.equal(new Set(all).size, 6);
      assert.equal(t.room.phase, "pairChat");
    }
  });
});

describe("a misbehaving AI never stalls the game", () => {
  test("createAiPlayer throws → game still reaches partners", async () => {
    const t = setup({ humans: 3, createThrows: true });
    await t.start();
    assert.equal(t.room.seats.length, 4, "AI seat kept");
    await t.advanceTo("partners");
    assert.equal(t.room.reveal!.aiPersona.name, "the AI");
  });

  test("onEvent and getRevealInfo throw → logged, game completes", async () => {
    const t = setup({
      humans: 3,
      player: () => ({
        onEvent() {
          throw new Error("onEvent boom");
        },
        getRevealInfo() {
          throw new Error("reveal boom");
        },
        dispose() {
          throw new Error("dispose boom");
        },
      }),
    });
    await t.start();
    await t.advanceTo("partners");
    assert.equal(t.room.reveal!.aiPersona.name, "the AI");
    assert.deepEqual(t.room.reveal!.aiNotes, []);
    assert.ok(t.logs.some((l) => l.includes("onEvent boom")));
    assert.ok(t.room.playAgain(t.host.id).ok, "dispose throwing doesn't block play again");
  });

  test("AI acting synchronously inside onEvent doesn't re-enter the room", async () => {
    const t = setup({
      humans: 3,
      player: (fake) => ({
        onEvent(e, view) {
          fake.events.push(e);
          if (view.phase === "answer") fake.actions!.submitAnswer("instant");
        },
        getRevealInfo: () => ({ persona: { name: "x", blurb: "" }, notes: [] }),
        dispose() {},
      }),
    });
    await t.start();
    await flush();
    assert.equal(t.room.answers.get(t.room.aiId!), "instant");
  });

  test("reveal notes are capped at 6", async () => {
    const t = setup({
      humans: 3,
      player: () => ({
        onEvent() {},
        getRevealInfo: () => ({
          persona: { name: "Sam", blurb: "b" },
          notes: Array.from({ length: 10 }, (_, i) => ({ round: 1 as const, text: `n${i}` })),
        }),
        dispose() {},
      }),
    });
    await t.start();
    await t.advanceTo("reveal");
    assert.equal(t.room.reveal!.aiNotes.length, 6);
  });
});

describe("host controls", () => {
  test("advance is host-only and not in lobby/partners", async () => {
    const t = setup({ humans: 3 });
    assert.equal(t.room.hostAdvance(t.host.id).ok, false, "lobby");
    await t.start();
    assert.equal(t.room.hostAdvance(t.humans[1]!.id).ok, false, "non-host");
    assert.ok(t.room.hostAdvance(t.host.id).ok);
    await flush();
    assert.equal(t.room.phase, "discuss");
    await t.advanceTo("reveal");
    assert.equal(t.room.phaseEndsAt, null, "reveal waits for the host");
    assert.ok(t.room.hostAdvance(t.host.id).ok);
    await flush();
    assert.equal(t.room.phase, "partners");
    assert.equal(t.room.hostAdvance(t.host.id).ok, false, "partners");
  });

  test("play again: same humans, no AI, fresh nicknames later, new persona, no repeated questions", async () => {
    let personaCalls = 0;
    const t = setup({
      humans: 3,
      persona: async () => {
        personaCalls++;
        return TEST_PERSONA;
      },
    });
    const { room, host, humans, fake } = t;
    await t.start();
    const firstPrompts = room.rounds.map((r) => r.promptId);
    assert.equal(room.playAgain(host.id).ok, false, "not in partners yet");
    await t.advanceTo("partners");
    const used = room.rounds.map((r) => r.promptId);
    assert.equal(room.playAgain(humans[1]!.id).ok, false, "non-host");
    assert.ok(room.playAgain(host.id).ok);
    assert.equal(fake.disposed, true);
    assert.equal(room.phase, "lobby");
    assert.equal(room.seats.length, 3);
    assert.ok(room.seats.every((s) => !s.isAi && !s.nickname));
    assert.equal(room.rounds.length, 0);
    assert.equal(room.messages.length, 0);
    assert.equal(personaCalls, 2);
    await t.start();
    await t.advanceTo("pairChat");
    for (const r of room.rounds) assert.ok(!used.includes(r.promptId), `${r.promptId} repeated`);
    assert.ok(firstPrompts.length > 0);
  });
});

describe("rooms registry", () => {
  test("TTL sweep closes idle rooms, tells their sockets, disposes the AI; active rooms survive", async () => {
    const t = setup({ humans: 3 });
    const registry = new RoomRegistry(t.room.deps);
    const idle = registry.create();
    const busy = registry.create();
    const res = idle.addHuman("Ana", true);
    assert.ok(res.ok);
    registry.bind("sockA", idle, res.playerId);
    registry.bind("screen", idle, null);
    idle.lastActivityAt = Date.now() - ROOM_TTL_MS - 1;
    registry.sweep();
    assert.equal(registry.get(idle.code), undefined);
    assert.ok(registry.get(busy.code));
    assert.equal(idle.closed, true);
    assert.deepEqual(t.closedSockets.map((c) => c.socketId).sort(), ["screen", "sockA"]);
    assert.equal(registry.lookup("sockA"), null);
    registry.closeAll("test");
  });

  test("codes are 4 letters without I/O, unique, and lookup is case-insensitive", () => {
    const t = setup({ humans: 1 });
    const registry = new RoomRegistry(t.room.deps);
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) codes.add(registry.create().code);
    assert.equal(codes.size, 200);
    for (const c of codes) assert.match(c, /^[A-HJ-NP-Z]{4}$/);
    const [first] = codes;
    assert.ok(registry.get(` ${first!.toLowerCase()} `));
    registry.closeAll("test");
  });

  test("rebinding a socket detaches it from its old seat", () => {
    const t = setup({ humans: 1 });
    const registry = new RoomRegistry(t.room.deps);
    const a = registry.create();
    const b = registry.create();
    const ra = a.addHuman("A", true);
    const rb = b.addHuman("B", true);
    assert.ok(ra.ok && rb.ok);
    registry.bind("s1", a, ra.playerId);
    registry.bind("s1", b, rb.playerId);
    assert.equal(a.seat(ra.playerId)!.connected, false);
    assert.equal(registry.lookup("s1")!.room, b);
    registry.unbind("s1");
    assert.equal(b.seat(rb.playerId)!.connected, false, "seat kept but disconnected");
    assert.ok(b.seat(rb.playerId), "seat kept");
    registry.closeAll("test");
  });
});
