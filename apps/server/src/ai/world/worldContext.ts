// World context for the persona: one cached Responses call with web_search,
// shared by every room in the process. Never throws. Logs counts only, never content.
import type { WorldContext } from "@game/shared";
import { museResponses } from "../muse.js";
import { oneLine, truncateAtWord, withTimeout } from "../util.js";
import { HACKTX_FACTS } from "./hacktx-facts.js";

const MUSE_TIMEOUT_MS = 25_000;
const OUTER_TIMEOUT_MS = 27_000; // safety net in case the wrapper's own timeout doesn't fire
const FAILURE_BACKOFF_MS = 5 * 60_000; // each search costs money: don't retry per room
const DEFAULT_TTL_MS = 3_600_000;
const MAX_ITEMS = 8;
const MAX_ITEM_CHARS = 120;
const MAX_WEATHER_CHARS = 80;

const LIST = { type: "array", items: { type: "string" } } as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["trending", "news", "local", "weather"],
  properties: { trending: LIST, news: LIST, local: LIST, weather: { type: ["string", "null"] } },
} as const;

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

class EmptyWorldContextError extends Error {
  override name = "EmptyResult";
}

interface Entry {
  value: WorldContext;
  storedAt: number;
  /** Set after a failed fetch: serve `value` without refetching until then. */
  retryAt: number | null;
}

let cache: Entry | null = null;
let inFlight: Promise<WorldContext> | null = null;
let generation = 0; // bumped by the test reset so stale fetches can't write back

function ttlMs(): number {
  const raw = process.env.WORLD_CONTEXT_TTL_MS;
  const n = raw ? Number(raw) : DEFAULT_TTL_MS;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

function fallbackValue(): WorldContext {
  return { fetchedAt: Date.now(), trending: [], news: [], local: [], weather: null, hacktx: HACKTX_FACTS };
}

function isFresh(e: Entry, now: number): boolean {
  return e.retryAt !== null ? now < e.retryAt : now - e.storedAt < ttlMs();
}

/**
 * Cached world context (TTL `WORLD_CONTEXT_TTL_MS`, default 60 min).
 * Stale-while-revalidate: anything cached (even expired) is returned at once,
 * and an expired entry kicks off one background refresh. Only a cold cache waits
 * on the fetch. Never throws; on failure returns the empty fallback.
 */
export async function getWorldContext(): Promise<WorldContext> {
  try {
    if (cache) {
      if (!inFlight && !isFresh(cache, Date.now())) void refresh();
      return cache.value;
    }
    return await (inFlight ?? refresh());
  } catch {
    return fallbackValue();
  }
}

/** Tests only: forget the cache and any in-flight fetch. */
export function resetWorldContextForTests(): void {
  generation++;
  cache = null;
  inFlight = null;
}

/** Starts the one in-flight fetch. Resolves with whatever is cached afterwards; never rejects. */
function refresh(): Promise<WorldContext> {
  const gen = generation;
  const started = Date.now();
  const p: Promise<WorldContext> = fetchWorldContext()
    .then(
      (value) => {
        if (gen === generation) cache = { value, storedAt: Date.now(), retryAt: null };
        const ms = Date.now() - started;
        console.log(
          `[world] refreshed in ${ms}ms (${value.trending.length} trending, ${value.news.length} news, ` +
            `${value.local.length} local, weather ${value.weather ? "yes" : "no"})`,
        );
        return value;
      },
      (err: unknown) => {
        const now = Date.now();
        const prev = gen === generation ? cache : null;
        const entry: Entry = prev
          ? { ...prev, retryAt: now + FAILURE_BACKOFF_MS }
          : { value: fallbackValue(), storedAt: now, retryAt: now + FAILURE_BACKOFF_MS };
        if (gen === generation) cache = entry;
        const name = err instanceof Error ? err.name : "Error";
        console.warn(
          `[world] fetch failed (${name}) after ${now - started}ms - using ${prev ? "stale" : "fallback"} for 5 min`,
        );
        return entry.value;
      },
    )
    .finally(() => {
      if (inFlight === p) inFlight = null;
    });
  inFlight = p;
  return p;
}

async function fetchWorldContext(): Promise<WorldContext> {
  const ac = new AbortController();
  try {
    const request = museResponses<unknown>(buildRequestBody(), {
      timeoutMs: MUSE_TIMEOUT_MS,
      label: "worldContext",
      signal: ac.signal,
    });
    const raw = await withTimeout(request, OUTER_TIMEOUT_MS);
    const data = sanitize(extractPayload(raw));
    if (!data.trending.length && !data.news.length && !data.local.length && !data.weather) {
      throw new EmptyWorldContextError("no usable world context");
    }
    return { fetchedAt: Date.now(), ...data, hacktx: HACKTX_FACTS };
  } catch (err) {
    ac.abort(); // stop the request if our safety-net timeout fired first
    throw err;
  }
}

function buildRequestBody(): Record<string, unknown> {
  const today = DATE_FMT.format(Date.now());
  return {
    input:
      `It is ${today}. A college student at HackTX at UT Austin this weekend. Find: 6 things people their age ` +
      "are talking about this week (trending topics, games, music, sports, memes), 4 current headlines, " +
      "5 Austin/UT-specific current details (events, sports, campus news), today's Austin weather. Short phrases.",
    tools: [{ type: "web_search" }],
    reasoning: { effort: "low" },
    text: { format: { type: "json_schema", name: "world_context", strict: true, schema: SCHEMA } },
  };
}

/** Accepts the parsed JSON, a JSON string, or a raw Responses object with `output_text`. */
function extractPayload(raw: unknown): unknown {
  if (typeof raw === "string") return JSON.parse(raw);
  if (raw && typeof raw === "object" && !("trending" in raw)) {
    const text = (raw as { output_text?: unknown }).output_text;
    if (typeof text === "string") return JSON.parse(text);
  }
  return raw;
}

/** Drop web-search citation debris: markdown links (keep the label) and bare URLs. */
function stripCitations(s: string): string {
  return s
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "");
}

function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? truncateAtWord(oneLine(stripCitations(v)), max) : "";
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const s = cleanText(item, MAX_ITEM_CHARS);
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function sanitize(payload: unknown): Pick<WorldContext, "trending" | "news" | "local" | "weather"> {
  const o = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    trending: cleanList(o.trending),
    news: cleanList(o.news),
    local: cleanList(o.local),
    weather: cleanText(o.weather, MAX_WEATHER_CHARS) || null,
  };
}

// Warm the cache at load so the first room doesn't wait on web search. The
// server only imports ai/ with AI_MODE=muse; tests run with AI_MODE=stub.
// (Kept at the bottom: the state above must be initialized first.)
if (process.env.AI_MODE === "muse") void getWorldContext();
