// Canned AI for AI_MODE=stub. Exports the same three names as src/ai/index.ts
// so the two modules are interchangeable, plus STUB_PERSONA (also the fallback
// when the real persona isn't ready at game start). Never calls Muse.
import type {
  AiNoteView,
  CreateAiPlayer,
  MatchmakerOutput,
  Persona,
  PlayerId,
  PrepareAiPersona,
  RoomView,
  RunMatchmaker,
} from "@game/shared";
import { randomPairing } from "./pairing.js";
import { clamp, pick, rand } from "./random.js";

export const STUB_PERSONA: Persona = {
  name: "Jordan",
  age: 20,
  school: "UT Austin",
  year: "sophomore",
  major: "computer science",
  hometown: "Houston",
  hackathonStory: "came with two roommates, building a study-group matcher, running on one donut and spite",
  interests: ["bouldering", "indie games", "making way too much cold brew"],
  opinions: ["breakfast tacos are the best breakfast, not up for debate", "group projects should be illegal"],
  facts: ["has a cat named Pixel back home", "works the front desk at PCL"],
  thisWeek: ["got lost in GDC looking for a bathroom", "had Round Rock Donuts for dinner"],
  style: { casing: "lowercase", emojiRate: 0.2, slang: ["ngl", "lowkey", "fr"], punctuation: "minimal" },
  blurb: "Jordan, sophomore CS from Houston",
};

const ANSWERS: Record<string, string[]> = {
  light: [
    "breakfast tacos no question, the rest arent even close",
    "honestly probably just sleeping somewhere with ac lol",
    "late night food run, its the only correct answer",
  ],
  personal: [
    "i taught myself to skateboard last summer and ate it like 40 times before i could ride",
    "i lowkey wanted to be a chef until i was like 15",
    "moving to austin from houston, didnt know anyone for the first month",
  ],
};
const GROUP_LINES = ["wait thats actually a good answer", "ngl i did not expect that one", "ok who answered the tacos one lol", "fr same"];
const PAIR_LINES = ["hii ok what do we have in common", "lol ok same actually", "wait thats so real"];
const COLLAB_LINES = ["we both have way too many tabs open at all times", "we both lowkey hate group projects"];

export const prepareAiPersona: PrepareAiPersona = () =>
  new Promise((resolve) => setTimeout(() => resolve(STUB_PERSONA), 1_000));

export const createAiPlayer: CreateAiPlayer = ({ aiPlayerId, persona, actions }) => {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  let repliedInPair = false;

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(
      () => {
        timers.delete(t);
        if (disposed) return;
        try {
          fn();
        } catch {
          // The stub must never throw into the server.
        }
      },
      Math.max(0, ms),
    );
    timers.add(t);
  };
  const msLeft = (view: RoomView) => (view.phaseEndsAt === null ? 0 : view.phaseEndsAt - view.serverNow);
  /** A random delay in [min, max] ms, pulled in so it lands `margin` ms before the phase ends. */
  const within = (view: RoomView, min: number, max: number, margin: number) =>
    clamp(rand(min, max), 0, Math.max(0, msLeft(view) - margin));
  const others = (view: RoomView): PlayerId[] => view.players.map((p) => p.id).filter((id) => id !== aiPlayerId);
  const partners = (view: RoomView): PlayerId[] =>
    view.pairs?.find((p) => p.members.includes(aiPlayerId))?.members.filter((id) => id !== aiPlayerId) ?? [];

  return {
    onEvent(event, view) {
      if (disposed) return;
      if (event.type === "phaseChanged") {
        const left = msLeft(view);
        switch (event.phase) {
          case "answer":
            later(within(view, 5_000, 15_000, 1_500), () =>
              actions.submitAnswer(pick(ANSWERS[view.round?.tier ?? "light"] ?? ANSWERS.light!)),
            );
            break;
          case "discuss": {
            const count = Math.random() < 0.5 ? 1 : 2;
            for (let i = 0; i < count; i++) {
              later(within(view, 3_000, left - 7_000, 7_000), () => actions.sendChat(pick(GROUP_LINES), "group"));
            }
            break;
          }
          case "vote":
          case "finalVote":
            later(within(view, 2_000, left - 1_000, 1_000), () => {
              const targets = others(view);
              if (targets.length > 0) actions.castVote(pick(targets));
            });
            break;
          case "pairChat":
            repliedInPair = false;
            later(rand(0.5, 0.7) * left, () => actions.submitCollab(pick(COLLAB_LINES)));
            break;
          case "pairResults":
            later(within(view, 1_000, 3_000, 1_000), () => {
              for (const id of partners(view)) actions.setVouch(id, true);
            });
            break;
        }
      } else if (event.type === "messageVisible") {
        const m = event.message;
        if (view.phase === "pairChat" && m.channel === "pair" && m.from !== aiPlayerId && !repliedInPair) {
          repliedInPair = true;
          later(within(view, 2_000, 5_000, 6_000), () => actions.sendChat(pick(PAIR_LINES), "pair"));
        }
      }
    },
    getRevealInfo() {
      const notes: AiNoteView[] = [
        { round: 1, text: "said tacos because everyone in texas says tacos" },
        { round: 3, text: "vouched for my partner, felt rude not to" },
      ];
      return { persona: { name: persona.name, blurb: persona.blurb }, notes };
    },
    dispose() {
      disposed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
};

export const runMatchmaker: RunMatchmaker = async (input) => {
  const ids = input.humans.map((h) => h.id);
  const { humanPairs, leftover } = randomPairing(ids);
  const target = leftover ? ids.filter((id) => id !== leftover) : [];
  const out: MatchmakerOutput = {
    humanPairs,
    leftover,
    sharedThings: [],
    suggestionForLeftover:
      leftover && target.length > 0 ? { targetId: pick(target), reason: "had the most interesting answer in round 2" } : null,
  };
  return out;
};
