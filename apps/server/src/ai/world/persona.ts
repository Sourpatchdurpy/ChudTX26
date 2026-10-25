// prepareAiPersona as a factory over its dependencies, so tests can run without
// Part 2's ai/player/ or Muse. Always resolves with a usable Persona. Logs timing only.
import type { MuseCall, Persona, PrepareAiPersona, RoomCode, WorldContext } from "@game/shared";
import { AbortedError, withTimeout } from "../util.js";

const WORLD_TIMEOUT_MS = 26_000; // getWorldContext has its own ~25s timeout; this is a backstop
const DEFAULT_PERSONA_TIMEOUT_MS = 15_000;

export interface PersonaDeps {
  getWorldContext: () => Promise<WorldContext>;
  generatePersona: (world: WorldContext, call: MuseCall) => Promise<Persona>;
  fallbackPersona: () => Persona;
  callFor: (roomCode: RoomCode, signal?: AbortSignal) => MuseCall;
  timeoutMs?: number; // generatePersona timeout, default 15_000
}

/** Used only if even Part 2's fallbackPersona() throws or returns junk. */
const LAST_RESORT_PERSONA: Persona = {
  name: "Sam",
  age: 20,
  school: "UT Austin",
  year: "junior",
  major: "electrical and computer engineering",
  hometown: "San Antonio",
  hackathonStory:
    "came with two friends from ECE, building a study-group matcher, running on Round Rock Donuts and zero sleep",
  interests: ["Smash Bros", "bouldering", "lo-fi playlists"],
  opinions: ["breakfast tacos are a personality trait", "8am classes should be illegal"],
  facts: ["lives in West Campus", "has a roommate who never leaves the PCL"],
  thisWeek: ["went down the bouncy house slide in the GDC courtyard", "watched some of the Smash tournament"],
  style: { casing: "lowercase", emojiRate: 0.2, slang: ["lol", "ngl", "fr"], punctuation: "minimal" },
  blurb: "Sam, junior ECE from San Antonio",
};

export function makePrepareAiPersona(deps: PersonaDeps): PrepareAiPersona {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PERSONA_TIMEOUT_MS;

  return async ({ roomCode, signal }) => {
    const started = Date.now();
    // Our own controller, so the Muse call also stops when we give up on it (timeout).
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let reason = "unusable";
    try {
      if (signal?.aborted) throw new AbortedError();
      const world = await withTimeout(deps.getWorldContext(), WORLD_TIMEOUT_MS, signal);
      const raw = await withTimeout(deps.generatePersona(world, deps.callFor(roomCode, ac.signal)), timeoutMs, signal);
      const persona = normalizePersona(raw);
      if (persona) {
        console.log(`[ai ${roomCode}] persona ready in ${Date.now() - started}ms (generated)`);
        return persona;
      }
    } catch (err) {
      reason = err instanceof Error ? err.name : "Error";
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    ac.abort();
    const { persona, lastResort } = safeFallback(deps);
    const why = lastResort ? `${reason}, last resort` : reason;
    console.log(`[ai ${roomCode}] persona ready in ${Date.now() - started}ms (fallback: ${why})`);
    return persona;
  };
}

function safeFallback(deps: PersonaDeps): { persona: Persona; lastResort: boolean } {
  try {
    const persona = normalizePersona(deps.fallbackPersona());
    if (persona) return { persona, lastResort: false };
  } catch {
    // fall through
  }
  return { persona: structuredClone(LAST_RESORT_PERSONA), lastResort: true };
}

/**
 * Null if the persona is unusable (no name, blurb or style). Otherwise a copy
 * with every array field forced to a string array, so prompt builders never crash.
 */
function normalizePersona(raw: unknown): Persona | null {
  if (!isRecord(raw) || !nonEmpty(raw.name) || !nonEmpty(raw.blurb) || !isRecord(raw.style)) return null;
  const p = raw as unknown as Persona;
  return {
    ...p,
    interests: strings(raw.interests),
    opinions: strings(raw.opinions),
    facts: strings(raw.facts),
    thisWeek: strings(raw.thisWeek),
    style: { ...p.style, slang: strings(raw.style.slang) },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
