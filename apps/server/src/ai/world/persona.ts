// prepareAiPersona as a factory over its dependencies, so tests can run without
// Part 2's ai/player/ or Muse. Always resolves with a usable Persona. Logs timing only.
import type { MuseCall, Persona, PrepareAiPersona, RoomCode, WorldContext } from "@game/shared";
import { AbortedError, withTimeout } from "../util.js";
import { fallbackPersona, validatePersona } from "@game/ai";

const WORLD_TIMEOUT_MS = 26_000; // getWorldContext has its own ~25s timeout; this is a backstop
const DEFAULT_PERSONA_TIMEOUT_MS = 15_000;

export interface PersonaDeps {
  getWorldContext: () => Promise<WorldContext>;
  generatePersona: (world: WorldContext, call: MuseCall) => Promise<Persona>;
  fallbackPersona: () => Persona;
  callFor: (roomCode: RoomCode, signal?: AbortSignal) => MuseCall;
  timeoutMs?: number; // generatePersona timeout, default 15_000
}

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
  return { persona: fallbackPersona(), lastResort: true };
}

/**
 * Use the current Part 2 contract: no names, style sections or partial sheets.
 */
function normalizePersona(raw: unknown): Persona | null {
  try { return validatePersona(raw); } catch { return null; }
}
