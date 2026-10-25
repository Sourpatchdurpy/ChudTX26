// THE privacy boundary. Every byte a browser (or the AI) sees comes from here.
// Before "reveal" a view must never expose: which seat is the AI, other people's
// real names (outside the lobby list), others' host flag, connection status,
// submission/vote timing or order, other pairs' messages, or the current
// round's answers before "discuss".
import { LIMITS, type MeView, type Phase, type PlayerId, type RoomView } from "@game/shared";
import type { Room, Seat } from "./Room.js";

const PHASE_ORDER: Phase[] = [
  "lobby",
  "answer",
  "discuss",
  "vote",
  "voteResult",
  "pairChat",
  "pairResults",
  "finalVote",
  "reveal",
  "partners",
];
const atOrAfter = (phase: Phase, ref: Phase) => PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf(ref);

export function buildView(room: Room, viewerId: PlayerId | null): RoomView {
  const { phase } = room;
  const seat = viewerId ? room.seat(viewerId) : undefined;
  const myPair = seat ? room.pairOf(seat.id) : undefined;
  const inLobby = phase === "lobby";
  const isVote = phase === "vote" || phase === "finalVote";

  return {
    code: room.code,
    serverNow: Date.now(),
    phase,
    phaseEndsAt: room.phaseEndsAt,
    me: seat ? buildMe(room, seat, myPair?.members ?? []) : null,
    // Sorted so the list doesn't reveal join order (and so who the host is).
    lobby: inLobby
      ? {
          realNames: room
            .humans()
            .map((s) => s.realName)
            .sort((a, b) => a.localeCompare(b)),
          minHumans: LIMITS.minHumans,
          maxHumans: LIMITS.maxHumans,
        }
      : null,
    players: inLobby ? [] : room.seats.map((s) => ({ id: s.id, nickname: s.nickname ?? "", emoji: s.emoji ?? "" })),
    round: room.currentRound ? { ...room.currentRound } : null,
    // Answers are only copied into the record at answer → discuss.
    history: room.rounds.map((r) => ({
      ...r,
      answers: r.answers.map((a) => ({ ...a })),
      voteCounts: r.voteCounts ? { ...r.voteCounts } : null,
    })),
    answerProgress: phase === "answer" ? { answered: room.answers.size, total: room.seats.length } : null,
    messages: room.messages
      .filter((m) => m.channel === "group" || (myPair !== undefined && m.pairId === myPair.id))
      .map((m) => ({ ...m })),
    voteProgress: isVote ? { voted: room.votes.size, total: room.seats.length } : null,
    lastVoteCounts: phase === "voteResult" ? { ...(room.currentRecord()?.voteCounts ?? {}) } : null,
    pairs: atOrAfter(phase, "pairChat") ? room.pairs.map((p) => ({ id: p.id, members: [...p.members] })) : null,
    collabResults: atOrAfter(phase, "pairResults") && room.collabResults ? { ...room.collabResults } : null,
    vouches: atOrAfter(phase, "finalVote") && room.vouches ? room.vouches.map((v) => ({ ...v })) : null,
    reveal: atOrAfter(phase, "reveal") && room.reveal ? structuredClone(room.reveal) : null,
  };
}

function buildMe(room: Room, seat: Seat, pairMembers: PlayerId[]): MeView {
  const partners = pairMembers.filter((id) => id !== seat.id);
  const mine = room.vouchDraft.get(seat.id);
  const isVote = room.phase === "vote" || room.phase === "finalVote" || room.phase === "voteResult" || room.phase === "reveal";
  return {
    id: seat.id,
    realName: seat.realName,
    nickname: seat.nickname ?? null,
    emoji: seat.emoji ?? null,
    isHost: seat.isHost,
    myAnswer: room.answers.get(seat.id) ?? null,
    myVote: isVote ? (room.votes.get(seat.id) ?? null) : null,
    myPairId: room.pairOf(seat.id)?.id ?? null,
    myCollabResult: room.collabDraft.get(seat.id) ?? null,
    myVouches: Object.fromEntries(partners.map((id) => [id, mine?.get(id) ?? false])),
    partnerCard: room.phase === "partners" ? structuredClone(room.partnerCards.get(seat.id) ?? null) : null,
  };
}
