// Round 3 matchmaker: one Muse call pairs the humans. The leftover (odd count)
// is picked here at random, never by the LLM, so who gets the AI as a partner
// stays unpredictable. Never rejects: any error, timeout or invalid output
// falls back to a random pairing of the same pool with the same leftover.
import type { MatchmakerInput, MatchmakerOutput, PlayerId, RunMatchmaker } from "@game/shared";
import { museCall, type MuseCallFn } from "../muse.js";
import { oneLine, pick, shuffle, truncateAtWord, withTimeout } from "../util.js";
import { buildMatchmakerRequest, makeAliases, type Aliases, type MatchmakerHuman } from "./prompt.js";

const DEFAULT_TIMEOUT_MS = 8000;
const MUSE_TIMEOUT_MARGIN_MS = 500; // Muse's own timeout fires before ours
const MIN_MUSE_TIMEOUT_MS = 1000;
const MAX_TEXT_CHARS = 100;
const PAIR_KEYS = new Set(["a", "b", "sharedThing"]);

export interface MatchmakerDeps {
  random: () => number;
  call: MuseCallFn;
  now?: () => number;
  log?: (line: string) => void;
}

type Pairing = [PlayerId, PlayerId][];
type SharedThings = MatchmakerOutput["sharedThings"];
type Suggestion = MatchmakerOutput["suggestionForLeftover"];

export const runMatchmaker: RunMatchmaker = (input, opts) =>
  runMatchmakerWith(input, opts, { random: Math.random, call: museCall });

export async function runMatchmakerWith(
  input: MatchmakerInput,
  opts: { timeoutMs: number },
  deps: MatchmakerDeps,
): Promise<MatchmakerOutput> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const t0 = now();
  const timeoutMs = Number.isFinite(opts?.timeoutMs) ? Math.max(0, opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  let pool: PlayerId[] = [];
  let leftover: PlayerId | null = null;
  try {
    const humans = humansOf(input);
    ({ pool, leftover } = splitLeftover(humans.map((h) => h.id), deps.random));
    if (pool.length === 0) {
      log(`[matchmaker] skipped Muse (${humans.length} human${humans.length === 1 ? "" : "s"})`);
      return { humanPairs: [], leftover, sharedThings: [], suggestionForLeftover: null };
    }

    const aliases = makeAliases(humans.map((h) => h.id), deps.random);
    const req = buildMatchmakerRequest({ input, humans, pool, leftover, aliases });
    const callOpts = {
      label: "matchmaker",
      timeoutMs: Math.max(MIN_MUSE_TIMEOUT_MS, timeoutMs - MUSE_TIMEOUT_MARGIN_MS),
      signal: ac.signal,
    };
    const raw = await withTimeout(
      Promise.resolve().then(() => deps.call<unknown>(req, callOpts)),
      timeoutMs,
    );

    const fix = textFixer(humans, aliases);
    const idOf = (alias: unknown) => (typeof alias === "string" ? aliases.idOf.get(alias.trim().toUpperCase()) : undefined);
    const suggestion = checkSuggestion(raw, idOf, leftover, fix);
    const checked = checkPairs(raw, idOf, pool, fix);
    const ms = now() - t0;
    const sugg = `suggestion ${suggestion ? "yes" : "no"}`;
    if (!checked.ok) {
      log(`[matchmaker] fallback to random (invalid: ${checked.reason}) in ${ms}ms (${sugg})`);
      return randomOutput(pool, leftover, deps.random, suggestion);
    }
    log(`[matchmaker] ok in ${ms}ms (${checked.pairs.length} pairs, ${sugg})`);
    return { humanPairs: checked.pairs, leftover, sharedThings: checked.sharedThings, suggestionForLeftover: suggestion };
  } catch (err) {
    ac.abort();
    log(`[matchmaker] fallback to random (${errorName(err)}) in ${now() - t0}ms`);
    return randomOutput(pool, leftover, deps.random, null);
  }
}

/** Unique humans, never the AI (defensive: the server shouldn't list it). */
function humansOf(input: MatchmakerInput): MatchmakerHuman[] {
  const seen = new Set<PlayerId>();
  const out: MatchmakerHuman[] = [];
  for (const h of input.humans ?? []) {
    if (!h || typeof h.id !== "string" || h.id === input.aiPlayerId || seen.has(h.id)) continue;
    seen.add(h.id);
    out.push({ id: h.id, nickname: typeof h.nickname === "string" ? h.nickname : "" });
  }
  return out;
}

/** Odd count: one uniformly random human sits out (they get the AI). The rest form the pool. */
function splitLeftover(ids: PlayerId[], random: () => number): { pool: PlayerId[]; leftover: PlayerId | null } {
  if (ids.length % 2 === 0) return { pool: ids, leftover: null };
  const leftover = pick(ids, random) ?? null;
  return { pool: ids.filter((id) => id !== leftover), leftover };
}

function randomOutput(pool: PlayerId[], leftover: PlayerId | null, random: () => number, suggestion: Suggestion): MatchmakerOutput {
  const order = shuffle(pool, random);
  const humanPairs: Pairing = [];
  for (let i = 0; i + 1 < order.length; i += 2) humanPairs.push([order[i]!, order[i + 1]!]);
  return { humanPairs, leftover, sharedThings: [], suggestionForLeftover: suggestion };
}

/** Model text → one short line; any alias it leaked ("P3") becomes that player's nickname. */
function textFixer(humans: MatchmakerHuman[], aliases: Aliases): (text: unknown) => string {
  const nickOf = new Map(humans.map((h) => [h.id, oneLine(h.nickname)]));
  return (text) => {
    if (typeof text !== "string") return "";
    const named = text.replace(/\bP\d{1,2}\b/g, (alias) => {
      const id = aliases.idOf.get(alias);
      return (id !== undefined && nickOf.get(id)) || alias;
    });
    return truncateAtWord(oneLine(named).replace(/^["“”]+|["“”]+$/g, "").trim(), MAX_TEXT_CHARS);
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

type PairCheck = { ok: true; pairs: Pairing; sharedThings: SharedThings } | { ok: false; reason: string };

/** Every pool human exactly once, pairs of 2 distinct pool ids, nothing else. */
function checkPairs(
  raw: unknown,
  idOf: (alias: unknown) => PlayerId | undefined,
  pool: PlayerId[],
  fix: (text: unknown) => string,
): PairCheck {
  const list = isRecord(raw) ? raw.pairs : undefined;
  if (!Array.isArray(list)) return { ok: false, reason: "no pairs" };
  const inPool = new Set(pool);
  const seen = new Set<PlayerId>();
  const pairs: Pairing = [];
  const sharedThings: SharedThings = [];
  for (const p of list) {
    if (!isRecord(p) || Object.keys(p).some((k) => !PAIR_KEYS.has(k))) return { ok: false, reason: "bad pair shape" };
    const a = idOf(p.a);
    const b = idOf(p.b);
    if (a === undefined || b === undefined) return { ok: false, reason: "unknown id" };
    if (a === b) return { ok: false, reason: "same person twice" };
    if (!inPool.has(a) || !inPool.has(b)) return { ok: false, reason: "leftover paired" };
    if (seen.has(a) || seen.has(b)) return { ok: false, reason: "duplicate id" };
    seen.add(a);
    seen.add(b);
    pairs.push([a, b]);
    const text = fix(p.sharedThing);
    if (text) sharedThings.push({ a, b, text });
  }
  if (seen.size !== inPool.size) return { ok: false, reason: "missing person" };
  return { ok: true, pairs, sharedThings };
}

/** Kept only for a real leftover, pointing at another known human, with a non-empty reason. */
function checkSuggestion(
  raw: unknown,
  idOf: (alias: unknown) => PlayerId | undefined,
  leftover: PlayerId | null,
  fix: (text: unknown) => string,
): Suggestion {
  if (leftover === null || !isRecord(raw)) return null;
  const s = raw.suggestionForLeftover;
  if (!isRecord(s)) return null;
  const targetId = idOf(s.targetId);
  if (targetId === undefined || targetId === leftover) return null;
  const reason = fix(s.reason);
  return reason ? { targetId, reason } : null;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name || "Error" : "error";
}
