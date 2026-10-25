// RevealPayload and PartnerCard assembly (PART_3 §7).
import type { AiNoteView, PartnerCard, PlayerId, RevealPayload, RoundNumber } from "@game/shared";
import { pick } from "./random.js";
import { errMsg, type Room } from "./Room.js";

const MAX_NOTES = 6;

function aiRevealInfo(room: Room): { persona: { name: string; blurb: string }; notes: AiNoteView[] } {
  const fallback = { persona: { name: "the AI", blurb: "" }, notes: [] };
  if (!room.ai) return fallback;
  try {
    const info = room.ai.getRevealInfo();
    const persona = {
      name: typeof info?.persona?.name === "string" && info.persona.name ? info.persona.name : "the AI",
      blurb: typeof info?.persona?.blurb === "string" ? info.persona.blurb : "",
    };
    const notes = (Array.isArray(info?.notes) ? info.notes : [])
      .filter((n) => n && typeof n.text === "string" && n.text.trim())
      .slice(0, MAX_NOTES)
      .map((n) => ({ round: n.round === 1 || n.round === 2 || n.round === 3 ? n.round : null, text: n.text }));
    return { persona, notes };
  } catch (e) {
    room.log(`getRevealInfo threw: ${errMsg(e)}`);
    return fallback;
  }
}

export function buildReveal(room: Room, finalVoteCounts: Record<PlayerId, number>, humansWon: boolean): RevealPayload {
  const aiId = room.aiId ?? "";
  const humans = room.humans();
  const { persona, notes } = aiRevealInfo(room);
  const rounds: RoundNumber[] = [1, 2, 3];

  const suspectedBy = humans
    .map((h) => ({ playerId: h.id, rounds: rounds.filter((r) => room.voteHistory.get(r)?.get(h.id) === aiId) }))
    .filter((s) => s.rounds.length > 0);

  const humanIds = new Set(humans.map((h) => h.id));
  const vouchedForAi = [
    ...new Set((room.vouches ?? []).filter((v) => v.target === aiId && v.vouched && humanIds.has(v.from)).map((v) => v.from)),
  ];

  let mostSuspiciousHuman: RevealPayload["mostSuspiciousHuman"] = null;
  for (const h of humans) {
    let total = 0;
    for (const r of rounds) for (const target of room.voteHistory.get(r)?.values() ?? []) if (target === h.id) total++;
    if (total > 0 && (!mostSuspiciousHuman || total > mostSuspiciousHuman.totalVotes)) {
      mostSuspiciousHuman = { playerId: h.id, totalVotes: total };
    }
  }

  return {
    aiPlayerId: aiId,
    humansWon,
    finalVoteCounts,
    realNames: Object.fromEntries(humans.map((h) => [h.id, h.realName])),
    aiPersona: persona,
    aiNotes: notes,
    suspectedBy,
    vouchedForAi,
    mostSuspiciousHuman,
  };
}

const normalize = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ");

export function buildPartnerCards(room: Room): Map<PlayerId, PartnerCard> {
  const cards = new Map<PlayerId, PartnerCard>();
  const humans = room.humans();
  const byId = new Map(humans.map((h) => [h.id, h]));
  const answerIn = (round: number, id: PlayerId) =>
    room.rounds.find((r) => r.round === round)?.answers.find((a) => a.playerId === id)?.text ?? null;
  const result = (id: PlayerId) => room.collabResults?.[id] ?? room.collabDraft.get(id) ?? null;

  for (const h of humans) {
    const others = room.pairOf(h.id)?.members.filter((m) => m !== h.id) ?? [];
    const humanPartners = others.filter((id) => byId.has(id));
    const card: PartnerCard = {
      kind: humanPartners.length > 0 ? "partner" : "aiPartner",
      partners: humanPartners.map((id) => ({
        playerId: id,
        nickname: byId.get(id)!.nickname ?? "",
        realName: byId.get(id)!.realName,
        collabResult: result(id),
      })),
      myCollabResult: result(h.id),
      aiWasInMyPair: room.aiId !== null && others.includes(room.aiId),
      suggestion: null,
    };

    if (card.kind === "aiPartner") {
      const mm = room.matchmakerOutput?.suggestionForLeftover;
      const target = mm && mm.targetId !== h.id ? byId.get(mm.targetId) : undefined;
      if (target && mm) {
        card.suggestion = { playerId: target.id, realName: target.realName, reason: mm.reason };
      } else {
        const candidates = humans.filter((o) => o.id !== h.id);
        const mine = normalize(answerIn(1, h.id));
        const same = mine ? candidates.filter((o) => normalize(answerIn(1, o.id)) === mine) : [];
        if (same.length > 0) {
          const o = pick(same);
          card.suggestion = { playerId: o.id, realName: o.realName, reason: "answered round 1 the same way you did" };
        } else if (candidates.length > 0) {
          // "Most interesting" is approximated by the longest round 2 answer.
          const o = [...candidates].sort((a, b) => (answerIn(2, b.id)?.length ?? 0) - (answerIn(2, a.id)?.length ?? 0))[0]!;
          card.suggestion = { playerId: o.id, realName: o.realName, reason: "had the most interesting answer in round 2" };
        }
      }
    }
    cards.set(h.id, card);
  }
  return cards;
}
