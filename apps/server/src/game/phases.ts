// Phase state machine. advance() runs the exit/entry actions for the current
// phase's transition (table in PART_3 §5), then enterPhase() sets the timer,
// logs, broadcasts and tells the AI. Each action is guarded so one failure
// never stops the room from reaching the next phase.
import type { MatchmakerInput, MatchmakerOutput, Phase, PlayerId, RoundNumber } from "@game/shared";
import { MATCHMAKER_HARD_TIMEOUT_MS, MATCHMAKER_TIMEOUT_MS, phaseDurationMs } from "./config.js";
import { applyPairing } from "./pairing.js";
import { buildPartnerCards, buildReveal } from "./reveal.js";
import { withTimeout } from "./random.js";
import { errMsg, type Room } from "./Room.js";

export function enterPhase(room: Room, phase: Phase): void {
  const from = room.phase;
  room.phase = phase;
  room.phaseSeq++;
  room.clearTimer();
  const duration = phaseDurationMs(phase);
  if (duration === null) room.phaseEndsAt = null;
  else room.schedulePhaseEnd(duration);
  room.touch();
  const r = room.roundNumber ? `r${room.roundNumber} ` : "";
  room.log(`${r}${from} → ${phase} (${room.seats.length} players)`);
  room.broadcast({ type: "phaseChanged", phase, round: room.roundNumber });
}

function guard(room: Room, label: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    room.log(`${label} failed: ${errMsg(e)}`);
  }
}

/** Ends the current phase and enters the next one. No-op while busy or closed. */
export async function advance(room: Room): Promise<void> {
  if (room.busy || room.closed) return;
  switch (room.phase) {
    case "answer":
      guard(room, "freezeAnswers", () => freezeAnswers(room));
      return enterPhase(room, "discuss");

    case "discuss":
      room.votes.clear();
      if (room.roundNumber === 2) guard(room, "startMatchmaker", () => startMatchmaker(room));
      return enterPhase(room, "vote");

    case "vote":
      guard(room, "countVotes", () => countVotes(room));
      return enterPhase(room, "voteResult");

    case "voteResult":
      if (room.roundNumber === 1) {
        guard(room, "beginRound", () => beginRound(room, 2));
        return enterPhase(room, "answer");
      }
      room.busy = true;
      try {
        await setupRound3(room);
      } catch (e) {
        room.log(`setupRound3 failed: ${errMsg(e)}`);
      } finally {
        room.busy = false;
      }
      if (room.closed || room.phase !== "voteResult") return;
      return enterPhase(room, "pairChat");

    case "pairChat":
      guard(room, "freezeCollab", () => freezeCollab(room));
      return enterPhase(room, "pairResults");

    case "pairResults":
      guard(room, "freezeVouches", () => freezeVouches(room));
      room.votes.clear();
      return enterPhase(room, "finalVote");

    case "finalVote":
      guard(room, "finishGame", () => finishGame(room));
      return enterPhase(room, "reveal");

    case "reveal":
      guard(room, "partnerCards", () => {
        room.partnerCards = buildPartnerCards(room);
      });
      return enterPhase(room, "partners");

    case "lobby":
    case "partners":
      return;
  }
}

// ── entry/exit actions ───────────────────────────────────────────────────────

/** New round 1 or 2: pick the prompt, push an empty RoundRecord. */
export function beginRound(room: Room, n: 1 | 2): void {
  const tier = n === 1 ? "light" : "personal";
  const q = room.deps.content.pickQuestion(tier, room.usedPromptIds);
  room.roundNumber = n;
  room.currentRound = { number: n, tier, promptId: q.id, prompt: q.text, submitPrompt: null };
  room.rounds.push({ round: n, tier, promptId: q.id, prompt: q.text, answers: [], voteCounts: null });
  room.answers.clear();
  room.votes.clear();
}

/** One answer per seat, in seat order (never submission order). */
function freezeAnswers(room: Room): void {
  const rec = room.currentRecord();
  if (!rec) return;
  rec.answers = room.seats.map((s) => ({ playerId: s.id, text: room.answers.get(s.id) ?? null }));
}

export function tally(room: Room): Record<PlayerId, number> {
  const counts: Record<PlayerId, number> = {};
  for (const s of room.seats) counts[s.id] = 0;
  for (const target of room.votes.values()) if (target in counts) counts[target]!++;
  return counts;
}

function countVotes(room: Room): void {
  const rec = room.currentRecord();
  if (rec) rec.voteCounts = tally(room);
  if (room.roundNumber) room.voteHistory.set(room.roundNumber, new Map(room.votes));
}

function startMatchmaker(room: Room): void {
  const aiId = room.aiId;
  if (!aiId) return;
  const input: MatchmakerInput = {
    humans: room.humans().map((s) => ({ id: s.id, nickname: s.nickname ?? "", realName: s.realName })),
    aiPlayerId: aiId,
    rounds: structuredClone(room.rounds.filter((r) => r.round === 1 || r.round === 2)),
    groupMessages: structuredClone(room.messages.filter((m) => m.channel === "group")),
  };
  let p: Promise<MatchmakerOutput>;
  try {
    p = room.deps.ai.runMatchmaker(input, { timeoutMs: MATCHMAKER_TIMEOUT_MS });
  } catch (e) {
    p = Promise.reject(e);
  }
  room.matchmakerPromise = withTimeout(p, MATCHMAKER_HARD_TIMEOUT_MS, "matchmaker").catch((e: unknown) => {
    room.log(`matchmaker failed, pairing randomly: ${errMsg(e)}`);
    return null;
  });
}

async function setupRound3(room: Room): Promise<void> {
  const out = room.matchmakerPromise ? await room.matchmakerPromise : null;
  if (room.closed) return;
  room.matchmakerOutput = out;
  const humanIds = room.humans().map((s) => s.id);
  room.pairs = room.aiId ? applyPairing(out, humanIds, room.aiId) : [];

  const { card, prompt } = room.deps.content.pickCollab(room.usedPromptIds);
  room.roundNumber = 3;
  room.currentRound = { number: 3, tier: "collab", promptId: card.id, prompt, submitPrompt: card.submitPrompt };
  room.rounds.push({ round: 3, tier: "collab", promptId: card.id, prompt, answers: [], voteCounts: null });
  room.answers.clear();
  room.votes.clear();
  room.collabDraft.clear();
  room.vouchDraft.clear();
}

function freezeCollab(room: Room): void {
  room.collabResults = {};
  for (const s of room.seats) room.collabResults[s.id] = room.collabDraft.get(s.id) ?? null;
}

/** Every member → every other member of their pair; unset vouches are false. */
function freezeVouches(room: Room): void {
  room.vouches = room.pairs.flatMap((pair) =>
    pair.members.flatMap((from) =>
      pair.members
        .filter((target) => target !== from)
        .map((target) => ({ from, target, vouched: room.vouchDraft.get(from)?.get(target) ?? false })),
    ),
  );
}

function finishGame(room: Room): void {
  const counts = tally(room);
  room.voteHistory.set(3 as RoundNumber, new Map(room.votes));
  const aiId = room.aiId;
  const aiVotes = aiId ? (counts[aiId] ?? 0) : 0;
  const maxHumanVotes = Math.max(0, ...room.humans().map((s) => counts[s.id] ?? 0));
  // Humans win only if the AI has strictly the most votes; ties go to the AI.
  room.reveal = buildReveal(room, counts, aiVotes > maxHumanVotes);
  room.log(`final vote: ${room.reveal.humansWon ? "humans" : "AI"} win (AI ${aiVotes}, top human ${maxHumanVotes})`);
}
