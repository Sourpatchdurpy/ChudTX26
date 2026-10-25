// Meta Muse client (Part 4): the only code that talks to the Model API.
// Every request passes the spending guardrails from MASTER_PLAN §8.1: token and
// reasoning clamps, a per-process budget cap, a per-minute rate cap, a timeout,
// and at most one retry (timeout / 429 / 5xx only). Logs token usage and the
// estimated cost of every call; never logs prompts, model output or the key.
import OpenAI from "openai";
import type { MuseCall, MuseChatRequest } from "@game/shared";
import { AbortedError, TimeoutError, oneLine, truncateAtWord } from "./util.js";

const BASE_URL = "https://api.meta.ai/v1";
const DEFAULT_MODEL = "muse-spark-1.3";
const MAX_COMPLETION_TOKENS = 1000;
/** A retry starts only with at least this long left before the caller's deadline (PART_2_DESIGN §3.2.1). */
const MIN_RETRY_MS = 1000;
/** Persona generation (label "persona") runs once per game in the lobby and needs room for reasoning plus a big JSON. */
const PERSONA_MAX_COMPLETION_TOKENS = 2000;
const RATE_WINDOW_MS = 60_000;

export class BudgetExceededError extends Error { override name = "BudgetExceededError"; }
export class RateCapError extends Error { override name = "RateCapError"; }
export class MuseUnavailableError extends Error { override name = "MuseUnavailableError"; }
/** Muse answered, but not with the JSON we asked for (empty, truncated or invalid). Never retried. */
export class MuseParseError extends Error { override name = "MuseParseError"; }

export interface MuseCallOptions {
  timeoutMs?: number;
  label?: string;
  /** External abort (dispose / phase change). Never retried. */
  signal?: AbortSignal;
  /** Absolute cutoff (Date.now() clock) for the whole call, retry included: each attempt's timeout shrinks to fit. */
  deadlineAtMs?: number;
  /** Per-room stats; falls back to req.prompt_cache_key. */
  roomCode?: string;
}

export type MuseCallFn = <T>(req: MuseChatRequest, opts?: MuseCallOptions) => Promise<T>;
export type MuseResponsesFn = <T>(body: Record<string, unknown>, opts?: MuseCallOptions) => Promise<T>;

/** `calls` counts requests actually sent (a retry is a second call); `failures` is how many of those failed. */
export interface MuseStats {
  calls: number;
  failures: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  searches: number;
  costUsd: number;
}

export interface MuseUsage {
  promptTokens: number;
  cachedTokens?: number;
  completionTokens: number;
  searches?: number;
}

/** The slice of the OpenAI client we use. The real client is adapted to it; tests inject a fake. */
export interface MuseClientLike {
  chat: { completions: { create(body: Record<string, unknown>, options: { signal: AbortSignal }): Promise<unknown> } };
  responses: { create(body: Record<string, unknown>, options: { signal: AbortSignal }): Promise<unknown> };
}

// ── state ──
let callOverride: MuseCallFn | null = null;
let responsesOverride: MuseResponsesFn | null = null;
let fakeClient: MuseClientLike | null = null;
let realClient: MuseClientLike | null = null;
let totals = emptyStats();
const rooms = new Map<string, MuseStats>();
let attemptTimes: number[] = []; // performance.now() of each request sent in the last minute
let rateCapLogged = false;
const warned = new Set<string>();

// ── env (read at call time: the server loads .env before importing ai/) ──
function envNumber(name: string, fallback: number, min: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= min) return n;
  warnOnce(`env:${name}`, `[muse] ignoring invalid ${name}=${raw}; using ${fallback}`);
  return fallback;
}
const defaultTimeoutMs = () => envNumber("MUSE_TIMEOUT_MS", 12_000, 1);
/** 0 blocks every call. "disabled" turns the dollar cap off on purpose (rate cap and cost logging stay on). */
function budgetUsd(): number {
  if (process.env.MUSE_BUDGET_USD?.trim().toLowerCase() === "disabled") {
    warnOnce("budget:disabled", "[muse] MUSE_BUDGET_USD=disabled: no dollar cap. Rate cap and cost logging stay on.");
    return Infinity;
  }
  return envNumber("MUSE_BUDGET_USD", 5, 0);
}
const budgetLabel = () => (Number.isFinite(budgetUsd()) ? String(budgetUsd()) : "no cap");
/** 0 blocks every call. */
const maxCallsPerMin = () => envNumber("MUSE_MAX_CALLS_PER_MIN", 60, 0);

function museModel(): string {
  const model = process.env.MUSE_MODEL?.trim() || DEFAULT_MODEL;
  if (/contributor/i.test(model)) {
    // MASTER_PLAN §8: Meta may train on -contributor traffic, and players' chats are private.
    warnOnce("contributor", `[muse] refusing MUSE_MODEL=${model} (a -contributor model); using ${DEFAULT_MODEL}`);
    return DEFAULT_MODEL;
  }
  return model;
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

// ── client ──
function getClient(): MuseClientLike {
  if (fakeClient) return fakeClient;
  if (realClient) return realClient;
  const apiKey = process.env.MODEL_API_KEY?.trim();
  if (!apiKey) {
    warnOnce("nokey", "[muse] MODEL_API_KEY is not set: Muse is unavailable, the AI will use fallbacks");
    throw new MuseUnavailableError("MODEL_API_KEY is not set");
  }
  try {
    const openai = new OpenAI({
      baseURL: BASE_URL,
      apiKey,
      maxRetries: 0, // our single retry is the only retry; the SDK's own would double-spend
      // Never let OPENAI_* env vars send other credentials or headers to Meta, or log request bodies.
      adminAPIKey: null,
      organization: null,
      project: null,
      logLevel: "warn",
    });
    // Casts: Meta's request shapes (e.g. reasoning_effort "minimal", the built-in web_search
    // tool) don't match OpenAI's types exactly.
    realClient = {
      chat: {
        completions: {
          create: (body, options) =>
            openai.chat.completions.create(body as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, options),
        },
      },
      responses: {
        create: (body, options) =>
          openai.responses.create(body as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming, options),
      },
    };
    return realClient;
  } catch (err) {
    throw new MuseUnavailableError(`could not create the Muse client: ${errorDetail(err)}`);
  }
}

// ── stats ──
function emptyStats(): MuseStats {
  return { calls: 0, failures: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0, searches: 0, costUsd: 0 };
}

function forRoom(room: string): MuseStats {
  let s = rooms.get(room);
  if (!s) rooms.set(room, (s = emptyStats()));
  return s;
}

function bump(room: string, update: (s: MuseStats) => void): void {
  update(totals);
  update(forRoom(room));
}

interface AttemptUsage {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  searches: number;
  /** True when the response had no usage block and we charged a conservative guess instead. */
  estimated: boolean;
}

export function estimateCostUsd(u: MuseUsage): number {
  const cached = Math.min(u.cachedTokens ?? 0, u.promptTokens);
  // $/1M tokens: input 1.25, cached input 0.15, output 4.25 (reasoning is already inside output); $2.50 per 1k searches.
  return ((u.promptTokens - cached) * 1.25 + cached * 0.15 + u.completionTokens * 4.25) / 1e6 + (u.searches ?? 0) * 0.0025;
}

export function getMuseStats(roomCode?: string): MuseStats {
  return { ...(roomCode === undefined ? totals : (rooms.get(roomCode) ?? emptyStats())) };
}

/** One summary line for the room, then forget it (called when the room's AI is disposed). */
export function logRoomMuseStats(roomCode: string): void {
  const s = rooms.get(roomCode);
  if (!s) return;
  rooms.delete(roomCode);
  console.log(
    `[muse] room=${roomCode} summary: ${s.calls} calls (${s.failures} failed) ` +
      `in=${s.promptTokens}(cached ${s.cachedTokens}) out=${s.completionTokens}(reasoning ${s.reasoningTokens})` +
      `${s.searches ? ` searches=${s.searches}` : ""} ~$${s.costUsd.toFixed(4)} | process total=$${totals.costUsd.toFixed(3)}/${budgetLabel()}`,
  );
}

// ── guardrails ──
function clampRequest(req: MuseChatRequest, label: string | undefined): MuseChatRequest {
  let out = req;
  const maxTokens = label === "persona" ? PERSONA_MAX_COMPLETION_TOKENS : MAX_COMPLETION_TOKENS;
  if (typeof req.max_completion_tokens === "number" && req.max_completion_tokens > maxTokens) {
    warnOnce(`clamp:tokens:${maxTokens}`, `[muse] max_completion_tokens=${req.max_completion_tokens} clamped to ${maxTokens} (budget guardrail)`);
    out = { ...out, max_completion_tokens: maxTokens };
  }
  if (req.reasoning_effort === "high" || req.reasoning_effort === "xhigh") {
    warnOnce("clamp:effort", `[muse] reasoning_effort=${req.reasoning_effort} downgraded to medium (budget guardrail)`);
    out = { ...out, reasoning_effort: "medium" };
  }
  return out;
}

function checkBudget(): void {
  const budget = budgetUsd();
  if (totals.costUsd < budget) return;
  if (!warned.has("budget")) {
    warned.add("budget");
    console.error(
      [
        "",
        "=".repeat(78),
        `[muse] BUDGET CAP HIT: estimated spend $${totals.costUsd.toFixed(3)} >= MUSE_BUDGET_USD=$${budget}`,
        "[muse] Every further Muse call is blocked; the AI is on fallback lines now.",
        "[muse] Check real spend in the Meta dashboard. Restarting resets this estimate.",
        "=".repeat(78),
        "",
      ].join("\n"),
    );
  }
  throw new BudgetExceededError(`estimated Muse spend $${totals.costUsd.toFixed(3)} reached MUSE_BUDGET_USD=$${budget}`);
}

/** Sliding 60s window over every request sent (retries included). Over the cap: throw, never wait. */
function takeRateSlot(): void {
  const now = performance.now();
  const max = maxCallsPerMin();
  while (attemptTimes.length > 0 && now - attemptTimes[0]! >= RATE_WINDOW_MS) attemptTimes.shift();
  if (attemptTimes.length >= max) {
    if (!rateCapLogged) {
      rateCapLogged = true;
      console.warn(`[muse] RATE CAP: ${attemptTimes.length} calls in the last 60s (MUSE_MAX_CALLS_PER_MIN=${max}); blocking until the window frees up. Is something calling Muse in a loop?`);
    }
    throw new RateCapError(`MUSE_MAX_CALLS_PER_MIN=${max} reached`);
  }
  rateCapLogged = false;
  attemptTimes.push(now);
}

// ── request plumbing ──
/** One request that our timeout and the caller's signal can both cancel. Settles even if the client ignores the signal. */
function sendOnce(send: (signal: AbortSignal) => Promise<unknown>, timeoutMs: number, external: AbortSignal | undefined): Promise<unknown> {
  const ac = new AbortController();
  return new Promise<unknown>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    };
    const fail = (err: Error) => {
      cleanup();
      reject(err);
      ac.abort(err);
    };
    const timer = setTimeout(() => fail(new TimeoutError(`timed out after ${timeoutMs}ms`)), timeoutMs);
    const onExternalAbort = () => fail(new AbortedError());
    external?.addEventListener("abort", onExternalAbort, { once: true });
    Promise.resolve()
      .then(() => send(ac.signal))
      .then(
        (res) => {
          cleanup();
          resolve(res);
        },
        (err: unknown) => {
          cleanup();
          reject(err);
        },
      );
  });
}

function httpStatus(err: unknown): number | undefined {
  const status = typeof err === "object" && err !== null ? (err as { status?: unknown }).status : undefined;
  return typeof status === "number" ? status : undefined;
}

/** Server error text for the log: one short line, never the API key. */
function errorDetail(err: unknown): string {
  const raw =
    typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : String(err);
  let msg = oneLine(raw).replace(/^\d{3}\s+/, ""); // the SDK prefixes the status
  const key = process.env.MODEL_API_KEY?.trim();
  if (key) msg = msg.split(key).join("[key]");
  return truncateAtWord(msg, 300) || "(no message)";
}

interface Endpoint<T> {
  send(client: MuseClientLike, signal: AbortSignal): Promise<unknown>;
  usage(res: unknown): AttemptUsage;
  /** Throws MuseParseError. */
  parse(res: unknown): T;
}

async function runGuarded<T>(ep: Endpoint<T>, label: string, room: string, opts: MuseCallOptions): Promise<T> {
  const configuredTimeoutMs = opts.timeoutMs !== undefined && opts.timeoutMs > 0 ? opts.timeoutMs : defaultTimeoutMs();
  const deadline = opts.deadlineAtMs !== undefined && Number.isFinite(opts.deadlineAtMs) ? opts.deadlineAtMs : Infinity;
  const tag = `[muse] ${label} room=${room}`;
  for (let attempt = 1; ; attempt++) {
    if (opts.signal?.aborted) throw new AbortedError(`muse ${label} aborted`);
    const remaining = deadline - Date.now();
    if (remaining <= 0 || (attempt > 1 && remaining < MIN_RETRY_MS)) {
      throw new TimeoutError(`muse ${label} reached its deadline`);
    }
    const timeoutMs = Math.min(configuredTimeoutMs, remaining);
    checkBudget();
    const client = getClient();
    takeRateSlot();
    bump(room, (s) => s.calls++);
    const started = performance.now();
    let res: unknown;
    try {
      res = await sendOnce((signal) => ep.send(client, signal), timeoutMs, opts.signal);
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      if (opts.signal?.aborted || err instanceof AbortedError) {
        console.log(`${tag} aborted ${ms}ms`);
        throw new AbortedError(`muse ${label} aborted`);
      }
      bump(room, (s) => s.failures++);
      const timedOut = err instanceof TimeoutError;
      const status = httpStatus(err);
      const retry = attempt === 1 && (timedOut || status === 429 || (status !== undefined && status >= 500));
      const why = timedOut
        ? "timeout"
        : status === 401 || status === 403
          ? `${status} (check MODEL_API_KEY and credits)`
          : status === 429 || (status !== undefined && status >= 500)
            ? String(status)
            : status !== undefined
              ? `${status}: ${errorDetail(err)}` // a bad request we need to see
              : `error: ${errorDetail(err)}`;
      console.warn(`${tag} FAILED ${ms}ms ${why}${retry ? " (retrying)" : ""}`);
      if (retry) continue; // deadline, budget, key and rate cap are re-checked at the top
      if (timedOut) throw new TimeoutError(`muse ${label} timed out after ${timeoutMs}ms`);
      throw err;
    }

    const ms = Math.round(performance.now() - started);
    const u = ep.usage(res);
    const cost = estimateCostUsd(u);
    bump(room, (s) => {
      s.promptTokens += u.promptTokens;
      s.cachedTokens += u.cachedTokens;
      s.completionTokens += u.completionTokens;
      s.reasoningTokens += u.reasoningTokens;
      s.searches += u.searches;
      s.costUsd += cost;
    });
    if (u.estimated) warnOnce("nousage", "[muse] response had no usage block: charging a conservative estimate toward the budget");
    console.log(
      `${tag} ${ms}ms in=${u.estimated ? "~" : ""}${u.promptTokens}${u.cachedTokens ? `(cached ${u.cachedTokens})` : ""} ` +
        `out=${u.estimated ? "~" : ""}${u.completionTokens}${u.reasoningTokens ? `(reasoning ${u.reasoningTokens})` : ""}` +
        `${u.searches ? ` searches=${u.searches}` : ""} ~$${cost.toFixed(4)} total=$${totals.costUsd.toFixed(3)}/${budgetLabel()}`,
    );
    try {
      return ep.parse(res);
    } catch (err) {
      bump(room, (s) => s.failures++);
      console.warn(`${tag} FAILED ${ms}ms ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}

const count = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
const asObject = (x: unknown): Record<string, unknown> => (typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {});

/** No usage reported: charge the whole prompt (≈4 chars/token) plus a full completion, so the budget cap still bites. */
function guessUsage(body: Record<string, unknown>, searches: number): AttemptUsage {
  const promptTokens = Math.ceil(JSON.stringify(body).length / 4);
  return { promptTokens, cachedTokens: 0, completionTokens: MAX_COMPLETION_TOKENS, reasoningTokens: 0, searches, estimated: true };
}

// ── Chat Completions ──
interface ChatResponseLike {
  choices?: { message?: { content?: string | null } | null; finish_reason?: string | null }[] | null;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
    completion_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
}

/** chat.completions.create with every guardrail; returns JSON.parse(choices[0].message.content). */
export const museCall: MuseCallFn = async <T>(req: MuseChatRequest, opts: MuseCallOptions = {}): Promise<T> => {
  if (callOverride) return callOverride<T>(req, opts);
  const body: Record<string, unknown> = { ...clampRequest(req, opts.label), model: museModel() };
  const room = opts.roomCode || req.prompt_cache_key || "-";
  return runGuarded<T>(
    {
      send: (client, signal) => client.chat.completions.create(body, { signal }),
      usage: (res) => {
        const u = (asObject(res) as ChatResponseLike).usage;
        if (!u || typeof u.prompt_tokens !== "number") return guessUsage(body, 0);
        return {
          promptTokens: count(u.prompt_tokens),
          cachedTokens: count(u.prompt_tokens_details?.cached_tokens),
          completionTokens: count(u.completion_tokens),
          reasoningTokens: count(u.completion_tokens_details?.reasoning_tokens),
          searches: 0,
          estimated: false,
        };
      },
      parse: (res) => {
        const choice = (asObject(res) as ChatResponseLike).choices?.[0];
        const content = choice?.message?.content;
        const finish = choice?.finish_reason ?? "?";
        if (typeof content !== "string" || content.trim() === "") throw new MuseParseError(`no content (finish_reason=${finish})`);
        try {
          return JSON.parse(content) as T;
        } catch {
          // finish_reason=length means max_completion_tokens cut the JSON off.
          throw new MuseParseError(`invalid JSON (finish_reason=${finish}, ${content.length} chars)`);
        }
      },
    },
    opts.label ?? "chat",
    room,
    opts,
  );
};

// Compile-time check: museCall must stay assignable to the contract's MuseCall.
const contractCheck: MuseCall = museCall;
void contractCheck;

/** A contract MuseCall bound to a room (stats) and an abort signal; what Part 2's generatePersona gets. */
export function museCallFor(roomCode: string, signal?: AbortSignal): MuseCall {
  return <T>(req: MuseChatRequest, opts: { timeoutMs?: number; label?: string } = {}) =>
    museCall<T>(req, { ...opts, roomCode, signal });
}

// ── Responses (only the cached world-context fetch, with web_search) ──
interface ResponsesResponseLike {
  status?: string;
  output_text?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] | null }[] | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number } | null;
    output_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
}

function responsesText(r: ResponsesResponseLike): string {
  if (typeof r.output_text === "string" && r.output_text.trim()) return r.output_text;
  // output_text is an SDK convenience; rebuild it from the message items if it's missing.
  const parts: string[] = [];
  for (const item of r.output ?? []) {
    if (item?.type !== "message") continue;
    for (const c of item.content ?? []) if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
  }
  return parts.join("");
}

/** The balanced {...} block starting at text[start] (string-aware), or null. */
function braceBlock(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** JSON.parse, else the first {...} block that parses (web-search answers can wrap JSON in prose, fences or citations). */
function parseJsonLoose(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text.trim()) };
  } catch {
    // fall through to block extraction
  }
  for (let i = text.indexOf("{"); i >= 0; i = text.indexOf("{", i + 1)) {
    const block = braceBlock(text, i);
    if (!block) continue;
    try {
      return { value: JSON.parse(block) };
    } catch {
      // try the next "{"
    }
  }
  return null;
}

/** responses.create with the same budget, rate, timeout and retry guardrails (no clamps). */
export async function museResponses<T>(body: Record<string, unknown>, opts: MuseCallOptions = {}): Promise<T> {
  if (responsesOverride) return responsesOverride<T>(body, opts);
  const fullBody: Record<string, unknown> = { ...body, model: museModel() };
  return runGuarded<T>(
    {
      send: (client, signal) => client.responses.create(fullBody, { signal }),
      usage: (res) => {
        const r = asObject(res) as ResponsesResponseLike;
        const searches = (r.output ?? []).filter((item) => item?.type === "web_search_call").length;
        const u = r.usage;
        if (!u || typeof u.input_tokens !== "number") return guessUsage(fullBody, searches);
        return {
          promptTokens: count(u.input_tokens),
          cachedTokens: count(u.input_tokens_details?.cached_tokens),
          completionTokens: count(u.output_tokens),
          reasoningTokens: count(u.output_tokens_details?.reasoning_tokens),
          searches,
          estimated: false,
        };
      },
      parse: (res) => {
        const r = asObject(res) as ResponsesResponseLike;
        const text = responsesText(r);
        if (!text.trim()) throw new MuseParseError(`no output text (status=${r.status ?? "?"})`);
        const parsed = parseJsonLoose(text);
        if (!parsed) throw new MuseParseError(`no JSON in output text (status=${r.status ?? "?"}, ${text.length} chars)`);
        return parsed.value as T;
      },
    },
    opts.label ?? "responses",
    opts.roomCode || "-",
    opts,
  );
}

// ── tests only ──
/** Make museCall (and so museCallFor) delegate entirely to fn. */
export function setMuseCallForTests(fn: MuseCallFn | null): void {
  callOverride = fn;
}
/** Make museResponses delegate entirely to fn. */
export function setMuseResponsesForTests(fn: MuseResponsesFn | null): void {
  responsesOverride = fn;
}
/** Run the real guardrail path against a fake client (skips the MODEL_API_KEY check). */
export function setMuseClientForTests(client: MuseClientLike | null): void {
  fakeClient = client;
}
export function resetMuseStateForTests(): void {
  callOverride = null;
  responsesOverride = null;
  fakeClient = null;
  realClient = null;
  totals = emptyStats();
  rooms.clear();
  attemptTimes = [];
  rateCapLogged = false;
  warned.clear();
}
