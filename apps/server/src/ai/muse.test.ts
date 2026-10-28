// Tests for the Muse client guardrails. Muse is always faked: no network, no key.
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { MuseCall, MuseChatRequest } from "@game/shared";
import {
  BudgetExceededError,
  MuseParseError,
  MuseUnavailableError,
  RateCapError,
  estimateCostUsd,
  getMuseStats,
  logRoomMuseStats,
  museCall,
  museCallFor,
  museResponses,
  resetMuseStateForTests,
  setMuseCallForTests,
  setMuseClientForTests,
  setMuseResponsesForTests,
  type MuseCallFn,
  type MuseClientLike,
} from "./muse.js";
import { AbortedError, TimeoutError } from "./util.js";

// ── helpers ──
type Body = Record<string, unknown>;
type Create = (body: Body, options: { signal: AbortSignal }) => Promise<unknown>;
interface Sent {
  body: Body;
  signal: AbortSignal;
}

/** Install a fake client; each create() call takes the next step (the last step repeats). */
function installFake(chatSteps: Create[], responsesSteps: Create[] = []) {
  const chat: Sent[] = [];
  const responses: Sent[] = [];
  const next = (steps: Create[], i: number): Create =>
    steps[Math.min(i, steps.length - 1)] ?? (() => Promise.reject(new Error("no fake step")));
  const client: MuseClientLike = {
    chat: {
      completions: {
        create: (body, options) => {
          chat.push({ body, signal: options.signal });
          return next(chatSteps, chat.length - 1)(body, options);
        },
      },
    },
    responses: {
      create: (body, options) => {
        responses.push({ body, signal: options.signal });
        return next(responsesSteps, responses.length - 1)(body, options);
      },
    },
  };
  setMuseClientForTests(client);
  return { chat, responses };
}

const usage = (inTok: number, cached: number, outTok: number, reasoning: number) => ({
  prompt_tokens: inTok,
  completion_tokens: outTok,
  prompt_tokens_details: { cached_tokens: cached },
  completion_tokens_details: { reasoning_tokens: reasoning },
});

const ok =
  (content: unknown, u: ReturnType<typeof usage> = usage(2900, 2400, 310, 120), finish = "stop"): Create =>
  async () => ({
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: finish }],
    usage: u,
  });

const httpError = (status: number, message = `${status} upstream said no`) => Object.assign(new Error(message), { status });
const fail =
  (status: number, message?: string): Create =>
  async () => {
    throw httpError(status, message);
  };

/** Only settles when its signal aborts (like the SDK on a hung request). */
const hang: Create = (_body, { signal }) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" })), {
      once: true,
    });
  });

const req = (over: Partial<MuseChatRequest> = {}): MuseChatRequest => ({
  messages: [
    { role: "developer", content: "rules" },
    { role: "user", content: "SECRET_PLAYER_TEXT hey whats up" },
  ],
  reasoning_effort: "minimal",
  max_completion_tokens: 600,
  prompt_cache_key: "ABCD",
  ...over,
});

const ENV_KEYS = ["MUSE_MODEL", "MUSE_TIMEOUT_MS", "MUSE_BUDGET_USD", "MUSE_MAX_CALLS_PER_MIN", "AI_BASE_URL", "AI_REASONING_EFFORT"] as const;
let savedEnv: Record<string, string | undefined> = {};
let logs: string[] = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error };

beforeEach(() => {
  resetMuseStateForTests();
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  logs = [];
  const capture = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
});

afterEach(() => {
  Object.assign(console, realConsole);
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetMuseStateForTests();
});

// ── tests ──
describe("museCall success path", () => {
  test("parses JSON, sends model + request, records usage into process and room stats", async () => {
    const fake = installFake([ok({ answer: "tacos", note: "n" })]);
    const out = await museCall<{ answer: string }>(req(), { label: "answer" });
    assert.deepEqual(out, { answer: "tacos", note: "n" });

    assert.equal(fake.chat.length, 1);
    const sent = fake.chat[0]!;
    assert.equal(sent.body.model, "muse-spark-1.3");
    assert.equal(sent.body.prompt_cache_key, "ABCD");
    assert.equal(sent.body.reasoning_effort, "minimal");
    assert.ok(sent.signal instanceof AbortSignal);
    assert.equal(sent.signal.aborted, false);

    const cost = estimateCostUsd({ promptTokens: 2900, cachedTokens: 2400, completionTokens: 310 });
    for (const s of [getMuseStats(), getMuseStats("ABCD")]) {
      assert.equal(s.calls, 1);
      assert.equal(s.failures, 0);
      assert.equal(s.promptTokens, 2900);
      assert.equal(s.cachedTokens, 2400);
      assert.equal(s.completionTokens, 310);
      assert.equal(s.reasoningTokens, 120);
      assert.equal(s.searches, 0);
      assert.ok(Math.abs(s.costUsd - cost) < 1e-12);
    }
    assert.deepEqual(getMuseStats("NOPE"), getMuseStats("ALSO-NOPE"));
    assert.equal(getMuseStats("NOPE").calls, 0);
  });

  test("opts.roomCode wins over prompt_cache_key; no key at all goes to '-'", async () => {
    installFake([ok({ a: 1 })]);
    await museCall(req(), { roomCode: "WXYZ" });
    await museCall(req({ prompt_cache_key: undefined }));
    assert.equal(getMuseStats("WXYZ").calls, 1);
    assert.equal(getMuseStats("ABCD").calls, 0);
    assert.equal(getMuseStats("-").calls, 1);
    assert.equal(getMuseStats().calls, 2);
  });

  test("MUSE_MODEL is read at call time; -contributor models are refused", async () => {
    const fake = installFake([ok({ a: 1 })]);
    process.env.MUSE_MODEL = "muse-spark-1.2";
    await museCall(req());
    process.env.MUSE_MODEL = "muse-spark-1.3-contributor";
    await museCall(req());
    assert.equal(fake.chat[0]!.body.model, "muse-spark-1.2");
    assert.equal(fake.chat[1]!.body.model, "muse-spark-1.3");
  });

  test("getMuseStats returns a copy", async () => {
    installFake([ok({ a: 1 })]);
    await museCall(req());
    getMuseStats().calls = 99;
    getMuseStats("ABCD").costUsd = 99;
    assert.equal(getMuseStats().calls, 1);
    assert.ok(getMuseStats("ABCD").costUsd < 1);
  });

  test("logRoomMuseStats prints one summary and deletes the room, keeping the process total", async () => {
    installFake([ok({ a: 1 })]);
    await museCall(req());
    await museCall(req());
    logs = [];
    logRoomMuseStats("ABCD");
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /room=ABCD summary: 2 calls \(0 failed\)/);
    assert.equal(getMuseStats("ABCD").calls, 0);
    assert.equal(getMuseStats().calls, 2);
    logs = [];
    logRoomMuseStats("ABCD"); // unknown room: silent
    assert.equal(logs.length, 0);
  });

  test("log line has usage and cost but never message content", async () => {
    installFake([ok({ answer: "MODEL_OUTPUT_TEXT" })]);
    await museCall(req(), { label: "answer" });
    const line = logs.find((l) => l.includes("[muse] answer"));
    assert.ok(line, "expected a per-call log line");
    assert.match(line, /^\[muse\] answer room=ABCD \d+ms in=2900\(cached 2400\) out=310\(reasoning 120\) ~\$0\.\d{4} total=\$0\.\d{3}\/5$/);
    for (const l of logs) {
      assert.ok(!l.includes("SECRET_PLAYER_TEXT"), "request content leaked into logs");
      assert.ok(!l.includes("MODEL_OUTPUT_TEXT"), "model output leaked into logs");
    }
  });
});

describe("estimateCostUsd", () => {
  test("input, cached, output and search pricing", () => {
    // (1000 × 1.25 + 2000 × 0.15 + 300 × 4.25) / 1e6 = 0.002825
    const base = estimateCostUsd({ promptTokens: 3000, cachedTokens: 2000, completionTokens: 300 });
    assert.ok(Math.abs(base - 0.002825) < 1e-12);
    const withSearch = estimateCostUsd({ promptTokens: 3000, cachedTokens: 2000, completionTokens: 300, searches: 4 });
    assert.ok(Math.abs(withSearch - (0.002825 + 0.01)) < 1e-12);
    assert.ok(Math.abs(estimateCostUsd({ promptTokens: 1_000_000, completionTokens: 0 }) - 1.25) < 1e-12);
    assert.ok(Math.abs(estimateCostUsd({ promptTokens: 0, completionTokens: 1_000_000 }) - 4.25) < 1e-12);
  });
});

describe("budget cap", () => {
  test("once the total reaches MUSE_BUDGET_USD, calls throw BudgetExceededError without reaching the client", async () => {
    process.env.MUSE_BUDGET_USD = "0.004";
    const fake = installFake([ok({ a: 1 }, usage(1000, 0, 1000, 0))]); // $0.0055
    await museCall(req());
    assert.equal(fake.chat.length, 1);
    await assert.rejects(museCall(req()), BudgetExceededError);
    await assert.rejects(museCall(req()), BudgetExceededError);
    assert.equal(fake.chat.length, 1);
    assert.equal(logs.filter((l) => l.includes("BUDGET CAP HIT")).length, 1, "banner prints once");
    process.env.MUSE_BUDGET_USD = "1"; // read at call time
    await museCall(req());
    assert.equal(fake.chat.length, 2);
  });

  test("MUSE_BUDGET_USD=0 blocks everything", async () => {
    process.env.MUSE_BUDGET_USD = "0";
    const fake = installFake([ok({ a: 1 })]);
    await assert.rejects(museCall(req()), BudgetExceededError);
    assert.equal(fake.chat.length, 0);
  });

  test("MUSE_BUDGET_USD=disabled turns the dollar cap off on purpose, with one warning; costs are still logged", async () => {
    process.env.MUSE_BUDGET_USD = "disabled";
    const fake = installFake([ok({ a: 1 }, usage(1_000_000, 0, 1_000_000, 0))]); // $5.50 per call
    await museCall(req());
    await museCall(req());
    assert.equal(fake.chat.length, 2);
    assert.equal(logs.filter((l) => l.includes("no dollar cap")).length, 1);
    assert.ok(logs.some((l) => l.includes("/no cap")), "cost lines still print");
    assert.ok(getMuseStats().costUsd > 10);
  });
});

describe("deadline (deadlineAtMs)", () => {
  test("a deadline that already passed makes no call", async () => {
    const fake = installFake([ok({ a: 1 })]);
    await assert.rejects(museCall(req(), { deadlineAtMs: Date.now() - 1 }), TimeoutError);
    assert.equal(fake.chat.length, 0);
  });

  test("the attempt timeout shrinks to the deadline, and a timeout at the deadline isn't retried", async () => {
    const fake = installFake([hang]);
    const started = Date.now();
    await assert.rejects(museCall(req(), { timeoutMs: 5_000, deadlineAtMs: Date.now() + 60 }), TimeoutError);
    assert.equal(fake.chat.length, 1);
    assert.ok(Date.now() - started < 1_000);
  });

  test("a 429 isn't retried with under 1s left before the deadline", async () => {
    const fake = installFake([fail(429), ok({ a: 1 })]);
    await assert.rejects(museCall(req(), { deadlineAtMs: Date.now() + 500 }), TimeoutError);
    assert.equal(fake.chat.length, 1);
  });

  test("with enough time left, the single retry still happens", async () => {
    const fake = installFake([fail(429), ok({ a: 1 })]);
    assert.deepEqual(await museCall(req(), { deadlineAtMs: Date.now() + 5_000 }), { a: 1 });
    assert.equal(fake.chat.length, 2);
  });
});

describe("rate cap", () => {
  test("the 3rd call in the window throws RateCapError without reaching the client", async () => {
    process.env.MUSE_MAX_CALLS_PER_MIN = "2";
    const fake = installFake([ok({ a: 1 })]);
    await museCall(req());
    await museCall(req());
    await assert.rejects(museCall(req()), RateCapError);
    assert.equal(fake.chat.length, 2);
  });

  test("a retry counts toward the window and is itself rate-capped", async () => {
    process.env.MUSE_MAX_CALLS_PER_MIN = "1";
    const fake = installFake([fail(429), ok({ a: 1 })]);
    await assert.rejects(museCall(req()), RateCapError);
    assert.equal(fake.chat.length, 1);
  });
});

describe("retries", () => {
  test("429 is retried once, then succeeds", async () => {
    const fake = installFake([fail(429), ok({ a: 1 })]);
    assert.deepEqual(await museCall(req(), { label: "answer" }), { a: 1 });
    assert.equal(fake.chat.length, 2);
    assert.equal(getMuseStats().calls, 2);
    assert.equal(getMuseStats().failures, 1);
    assert.ok(logs.some((l) => /\[muse\] answer room=ABCD FAILED \d+ms 429 \(retrying\)/.test(l)));
  });

  test("500 twice throws after exactly 2 calls", async () => {
    const fake = installFake([fail(500)]);
    await assert.rejects(museCall(req()), (err: unknown) => (err as { status?: number }).status === 500);
    assert.equal(fake.chat.length, 2);
    assert.equal(getMuseStats().failures, 2);
  });

  test("503 then success", async () => {
    const fake = installFake([fail(503), ok({ a: 2 })]);
    assert.deepEqual(await museCall(req()), { a: 2 });
    assert.equal(fake.chat.length, 2);
  });

  for (const status of [400, 401, 402, 403, 404, 422]) {
    test(`${status} is never retried`, async () => {
      const fake = installFake([fail(status), ok({ a: 1 })]);
      await assert.rejects(museCall(req()), (err: unknown) => (err as { status?: number }).status === status);
      assert.equal(fake.chat.length, 1);
    });
  }

  test("a 400 logs the server's message", async () => {
    installFake([fail(400, "400 Unsupported parameter: 'stop'")]);
    await assert.rejects(museCall(req(), { label: "answer" }));
    assert.ok(logs.some((l) => /\[muse\] answer room=ABCD FAILED \d+ms 400: Unsupported parameter: 'stop'$/.test(l)));
  });

  test("errors without an HTTP status (e.g. connection errors) are not retried", async () => {
    const fake = installFake([
      async () => {
        throw new Error("Connection error.");
      },
    ]);
    await assert.rejects(museCall(req()), /Connection error/);
    assert.equal(fake.chat.length, 1);
  });

  test("our timeout is retried once, then throws TimeoutError", async () => {
    const fake = installFake([hang]);
    const started = Date.now();
    await assert.rejects(museCall(req(), { timeoutMs: 30 }), TimeoutError);
    assert.equal(fake.chat.length, 2);
    assert.ok(fake.chat.every((c) => c.signal.aborted), "each timed-out request is aborted");
    assert.ok(Date.now() - started < 1000);
    assert.ok(logs.some((l) => /FAILED \d+ms timeout \(retrying\)/.test(l)));
  });

  test("MUSE_TIMEOUT_MS is the default timeout", async () => {
    process.env.MUSE_TIMEOUT_MS = "25";
    const fake = installFake([hang]);
    await assert.rejects(museCall(req()), TimeoutError);
    assert.equal(fake.chat.length, 2);
  });

  test("a client that ignores its signal still can't stall the call", async () => {
    const fake = installFake([() => new Promise(() => {})]);
    await assert.rejects(museCall(req(), { timeoutMs: 20 }), TimeoutError);
    assert.equal(fake.chat.length, 2);
  });

  test("external abort: 1 call, no retry, AbortedError", async () => {
    const fake = installFake([hang]);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 15);
    await assert.rejects(museCall(req(), { signal: ac.signal, timeoutMs: 5000 }), AbortedError);
    assert.equal(fake.chat.length, 1);
    assert.equal(fake.chat[0]!.signal.aborted, true, "the in-flight request is cancelled");
    assert.equal(getMuseStats().failures, 0, "a cancellation is not a failure");
  });

  test("an already-aborted signal never reaches the client", async () => {
    const fake = installFake([ok({ a: 1 })]);
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(museCall(req(), { signal: ac.signal }), AbortedError);
    assert.equal(fake.chat.length, 0);
  });

  test("invalid JSON: 1 call, no retry, MuseParseError, usage still recorded", async () => {
    const fake = installFake([ok('{"answer": "cut off', usage(900, 0, 1000, 700), "length")]);
    await assert.rejects(museCall(req(), { label: "answer" }), MuseParseError);
    assert.equal(fake.chat.length, 1);
    const s = getMuseStats("ABCD");
    assert.equal(s.calls, 1);
    assert.equal(s.failures, 1);
    assert.equal(s.completionTokens, 1000);
    assert.ok(s.costUsd > 0);
    assert.ok(logs.some((l) => l.includes("FAILED") && l.includes("finish_reason=length")));
    assert.ok(!logs.some((l) => l.includes("cut off")), "model output stays out of logs");
  });

  test("null content throws MuseParseError", async () => {
    installFake([
      async () => ({ choices: [{ message: { content: null }, finish_reason: "stop" }], usage: usage(10, 0, 10, 0) }),
    ]);
    await assert.rejects(museCall(req()), MuseParseError);
  });

  test("a response with no usage is charged a conservative estimate", async () => {
    installFake([async () => ({ choices: [{ message: { content: '{"a":1}' }, finish_reason: "stop" }] })]);
    assert.deepEqual(await museCall(req()), { a: 1 });
    const s = getMuseStats();
    assert.equal(s.completionTokens, 1000);
    assert.ok(s.promptTokens > 0);
    assert.ok(s.costUsd > 0);
  });
});

describe("clamps", () => {
  test("max_completion_tokens > 1000 is clamped to 1000; high/xhigh effort becomes medium", async () => {
    const fake = installFake([ok({ a: 1 })]);
    const original = req({ max_completion_tokens: 5000, reasoning_effort: "xhigh" });
    await museCall(original);
    await museCall(req({ reasoning_effort: "high" }));
    await museCall(req({ reasoning_effort: "low", max_completion_tokens: 800 }));
    assert.equal(fake.chat[0]!.body.max_completion_tokens, 1000);
    assert.equal(fake.chat[0]!.body.reasoning_effort, "medium");
    assert.equal(fake.chat[1]!.body.reasoning_effort, "medium");
    assert.equal(fake.chat[2]!.body.reasoning_effort, "low");
    assert.equal(fake.chat[2]!.body.max_completion_tokens, 800);
    assert.equal(original.max_completion_tokens, 5000, "the caller's request is not mutated");
    assert.equal(original.reasoning_effort, "xhigh");
    assert.equal(logs.filter((l) => l.includes("clamped to 1000")).length, 1, "one-time warning");
    assert.equal(logs.filter((l) => l.includes("downgraded to medium")).length, 1, "one-time warning");
  });

  test('label "persona" may use up to 2000 completion tokens; everything else stays at 1000', async () => {
    const fake = installFake([ok({ a: 1 })]);
    await museCall(req({ max_completion_tokens: 1800 }), { label: "persona" });
    await museCall(req({ max_completion_tokens: 5000 }), { label: "persona" });
    await museCall(req({ max_completion_tokens: 1800 }), { label: "group" });
    assert.equal(fake.chat[0]!.body.max_completion_tokens, 1800);
    assert.equal(fake.chat[1]!.body.max_completion_tokens, 2000);
    assert.equal(fake.chat[2]!.body.max_completion_tokens, 1000);
  });
});

describe("missing key", () => {
  test("no MODEL_API_KEY and no fake client → MuseUnavailableError, no network", async () => {
    const saved = process.env.MODEL_API_KEY;
    delete process.env.MODEL_API_KEY;
    try {
      await assert.rejects(museCall(req()), MuseUnavailableError);
      await assert.rejects(museResponses({ input: "x" }), MuseUnavailableError);
      assert.equal(getMuseStats().calls, 0);
      assert.equal(logs.filter((l) => l.includes("MODEL_API_KEY is not set")).length, 1, "warns once");
    } finally {
      if (saved !== undefined) process.env.MODEL_API_KEY = saved;
    }
  });
});

describe("another provider (AI_BASE_URL)", () => {
  test("drops Muse-only fields, sends developer rules as system, and estimates no cost", async () => {
    process.env.AI_BASE_URL = "https://models.example.com/v1/";
    process.env.MUSE_MODEL = "vendor/small-model";
    const fake = installFake([ok({ a: 1 })]);
    await museCall(req(), { label: "group" });
    const body = fake.chat[0]!.body;
    assert.equal(body.model, "vendor/small-model");
    assert.equal("prompt_cache_key" in body, false);
    assert.equal("reasoning_effort" in body, false);
    assert.equal(body.max_completion_tokens, 600);
    assert.deepEqual((body.messages as { role: string }[]).map((m) => m.role), ["system", "user"]);
    assert.equal(getMuseStats("ABCD").calls, 1, "the room still comes from prompt_cache_key");
    assert.equal(getMuseStats().costUsd, 0);
  });

  test("AI_REASONING_EFFORT is sent as given", async () => {
    process.env.AI_BASE_URL = "https://models.example.com/v1";
    process.env.MUSE_MODEL = "vendor/small-model";
    process.env.AI_REASONING_EFFORT = "low";
    const fake = installFake([ok({ a: 1 })]);
    await museCall(req());
    assert.equal(fake.chat[0]!.body.reasoning_effort, "low");
  });

  test("without MUSE_MODEL nothing is sent; web search is never attempted", async () => {
    process.env.AI_BASE_URL = "https://models.example.com/v1";
    const fake = installFake([ok({ a: 1 })], [ok({ a: 1 })]);
    await assert.rejects(museCall(req()), MuseUnavailableError);
    process.env.MUSE_MODEL = "vendor/small-model";
    await assert.rejects(museResponses({ input: "x" }), MuseUnavailableError);
    assert.equal(fake.chat.length + fake.responses.length, 0);
  });

  test("the Meta URL itself (with a trailing slash) keeps Muse behavior", async () => {
    process.env.AI_BASE_URL = "https://api.meta.ai/v1/";
    const fake = installFake([ok({ a: 1 })]);
    await museCall(req());
    assert.equal(fake.chat[0]!.body.model, "muse-spark-1.3");
    assert.equal(fake.chat[0]!.body.prompt_cache_key, "ABCD");
    assert.ok(getMuseStats().costUsd > 0);
  });
});

describe("museResponses", () => {
  const responsesUsage = { input_tokens: 4000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 800, output_tokens_details: { reasoning_tokens: 300 } };

  test("counts web_search_call items into searches and cost; parses output_text", async () => {
    const fake = installFake(
      [],
      [
        async () => ({
          status: "completed",
          output: [
            { type: "web_search_call" },
            { type: "web_search_call" },
            { type: "reasoning" },
            { type: "web_search_call" },
            { type: "message", content: [{ type: "output_text", text: '{"trending":["x"]}' }] },
          ],
          output_text: '{"trending":["x"]}',
          usage: responsesUsage,
        }),
      ],
    );
    const body = { input: "what's trending", tools: [{ type: "web_search" }], reasoning: { effort: "high" } };
    const out = await museResponses<{ trending: string[] }>(body, { label: "world", roomCode: "ABCD" });
    assert.deepEqual(out, { trending: ["x"] });
    assert.equal(fake.responses.length, 1);
    assert.equal(fake.responses[0]!.body.model, "muse-spark-1.3");
    assert.deepEqual(fake.responses[0]!.body.reasoning, { effort: "high" }, "no clamps on Responses");
    const expected = estimateCostUsd({ promptTokens: 4000, cachedTokens: 0, completionTokens: 800, searches: 3 });
    for (const s of [getMuseStats(), getMuseStats("ABCD")]) {
      assert.equal(s.searches, 3);
      assert.equal(s.reasoningTokens, 300);
      assert.ok(Math.abs(s.costUsd - expected) < 1e-12);
    }
    assert.ok(logs.some((l) => /^\[muse\] world room=ABCD \d+ms .* searches=3 ~\$/.test(l)));
  });

  test("falls back to the first parseable {...} block in prose / fences / citations", async () => {
    const text = 'Here you go {cite:1}:\n```json\n{"news": ["a {b}", "c \\"}\\" d"], "n": 2}\n```\nDone.';
    installFake([], [async () => ({ output_text: text, output: [], usage: responsesUsage })]);
    assert.deepEqual(await museResponses({ input: "x" }), { news: ["a {b}", 'c "}" d'], n: 2 });
    assert.equal(getMuseStats("-").calls, 1, "room defaults to '-'");
  });

  test("rebuilds the text from message items when output_text is missing", async () => {
    installFake(
      [],
      [async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }], usage: responsesUsage })],
    );
    assert.deepEqual(await museResponses({ input: "x" }), { ok: true });
  });

  test("no JSON at all throws MuseParseError (not retried)", async () => {
    const fake = installFake([], [async () => ({ output_text: "sorry, no idea", output: [], usage: responsesUsage })]);
    await assert.rejects(museResponses({ input: "x" }), MuseParseError);
    assert.equal(fake.responses.length, 1);
  });

  test("same retry and budget guardrails as museCall", async () => {
    const fake = installFake([], [fail(502), async () => ({ output_text: '{"a":1}', output: [], usage: responsesUsage })]);
    assert.deepEqual(await museResponses({ input: "x" }), { a: 1 });
    assert.equal(fake.responses.length, 2);
    process.env.MUSE_BUDGET_USD = "0.000001";
    await assert.rejects(museResponses({ input: "x" }), BudgetExceededError);
    assert.equal(fake.responses.length, 2);
  });
});

describe("test overrides", () => {
  test("setMuseCallForTests replaces museCall; museCallFor passes roomCode and signal through", async () => {
    const fake = installFake([ok({ never: true })]);
    const seen: { req: MuseChatRequest; opts: unknown }[] = [];
    const override: MuseCallFn = async <T>(r: MuseChatRequest, opts?: unknown) => {
      seen.push({ req: r, opts });
      return { stubbed: true } as T;
    };
    setMuseCallForTests(override);

    assert.deepEqual(await museCall(req(), { label: "direct" }), { stubbed: true });
    const ac = new AbortController();
    const bound: MuseCall = museCallFor("ROOM", ac.signal);
    assert.deepEqual(await bound(req(), { label: "persona", timeoutMs: 999 }), { stubbed: true });

    assert.equal(fake.chat.length, 0, "override bypasses the client");
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[1]!.opts, { label: "persona", timeoutMs: 999, roomCode: "ROOM", signal: ac.signal });

    setMuseCallForTests(null);
    assert.deepEqual(await museCall(req()), { never: true });
    assert.equal(fake.chat.length, 1);
  });

  test("museCallFor on the real path keys stats by room and honours the signal", async () => {
    const fake = installFake([ok({ a: 1 }), hang]);
    const ac = new AbortController();
    const call = museCallFor("ROOM", ac.signal);
    await call(req({ prompt_cache_key: "OTHER" }));
    assert.equal(getMuseStats("ROOM").calls, 1);
    assert.equal(getMuseStats("OTHER").calls, 0);
    setTimeout(() => ac.abort(), 10);
    await assert.rejects(call(req(), { timeoutMs: 5000 }), AbortedError);
    assert.equal(fake.chat.length, 2);
  });

  test("setMuseResponsesForTests replaces museResponses", async () => {
    const fake = installFake([], [async () => ({ output_text: '{"real":1}', output: [], usage: {} })]);
    setMuseResponsesForTests(async <T>() => ({ fake: 1 }) as T);
    assert.deepEqual(await museResponses({ input: "x" }), { fake: 1 });
    assert.equal(fake.responses.length, 0);
  });

  test("resetMuseStateForTests clears overrides, fake client and stats", async () => {
    installFake([ok({ a: 1 })]);
    await museCall(req());
    setMuseCallForTests(async <T>() => ({}) as T);
    resetMuseStateForTests();
    assert.equal(getMuseStats().calls, 0);
    assert.equal(getMuseStats("ABCD").calls, 0);
    const saved = process.env.MODEL_API_KEY;
    delete process.env.MODEL_API_KEY;
    try {
      await assert.rejects(museCall(req()), MuseUnavailableError, "no override and no fake client left");
    } finally {
      if (saved !== undefined) process.env.MODEL_API_KEY = saved;
    }
  });
});
