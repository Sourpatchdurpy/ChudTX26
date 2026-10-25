// Tests for ai/world/. Muse is always faked: setMuseResponsesForTests / setMuseCallForTests
// or plain deps for the persona factory. No network.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import type { MuseCall, Persona, WorldContext } from "@game/shared";
import { fallbackPersona } from "@game/ai";
import { setMuseCallForTests, setMuseResponsesForTests } from "../muse.js";
import { HACKTX_FACTS } from "./hacktx-facts.js";
import { makePrepareAiPersona, type PersonaDeps } from "./persona.js";
import { prepareAiPersona } from "./prepareAiPersona.js";
import { getWorldContext, resetWorldContextForTests } from "./worldContext.js";

// ── helpers ──────────────────────────────────────────────────────────────────

type ResponsesFn = NonNullable<Parameters<typeof setMuseResponsesForTests>[0]>;
type CallFn = NonNullable<Parameters<typeof setMuseCallForTests>[0]>;
type Opts = Parameters<ResponsesFn>[1];
interface Seen {
  body: Record<string, unknown>;
  opts: Opts;
}

let seen: Seen[] = [];
let logs: string[] = [];

/** Fake museResponses; `impl` gets the 0-based call index. */
function fakeResponses(impl: (n: number) => unknown | Promise<unknown>): void {
  const fn = async (body: Record<string, unknown>, opts?: Opts) => {
    seen.push({ body, opts });
    return impl(seen.length - 1);
  };
  setMuseResponsesForTests(fn as ResponsesFn);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
};

function captureLogs(): void {
  logs = [];
  const push = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  mock.method(console, "log", push);
  mock.method(console, "warn", push);
  mock.method(console, "error", push);
}

const GOOD = {
  trending: ["new Zelda trailer", "Astros in the playoffs"],
  news: ["Nintendo teases a new console"],
  local: ["Texas beat OU", "ACL lineup rumors"],
  weather: "low 80s and humid",
};

const MIN = 60_000;
// Saturday Oct 24 2026, 12:00 in Austin (CDT, UTC-5).
const NOW = Date.UTC(2026, 9, 24, 17, 0, 0);

// ── world context ────────────────────────────────────────────────────────────

describe("getWorldContext", () => {
  beforeEach(() => {
    resetWorldContextForTests();
    seen = [];
    captureLogs();
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  });

  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
    setMuseResponsesForTests(null);
    delete process.env.WORLD_CONTEXT_TTL_MS;
    resetWorldContextForTests();
  });

  test("one web_search Responses call with a strict schema, sanitized result", async () => {
    const long = "word ".repeat(60).trim(); // 299 chars
    fakeResponses(() => ({
      trending: [
        "  new Zelda\n trailer  ",
        42,
        null,
        "",
        "   ",
        long,
        "NEW ZELDA TRAILER",
        "Astros win ([espn.com](https://espn.com/x))",
        "see [this meme](https://x.com/y) everywhere",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
      ],
      news: ["Nintendo teases a new console https://news.example.com/a"],
      local: "not an array",
      weather: "w".repeat(30) + " " + "x".repeat(30) + " " + "y".repeat(30),
    }));

    const ctx = await getWorldContext();

    assert.equal(seen.length, 1);
    const { body, opts } = seen[0]!;
    assert.deepEqual(body.tools, [{ type: "web_search" }]);
    assert.deepEqual(body.reasoning, { effort: "low" });
    const format = (body.text as { format: Record<string, unknown> }).format;
    assert.equal(format.type, "json_schema");
    assert.equal(format.name, "world_context");
    assert.equal(format.strict, true);
    const schema = format.schema as {
      type: string;
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, { type: unknown }>;
    };
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual([...schema.required].sort(), ["local", "news", "trending", "weather"]);
    assert.deepEqual(schema.properties.weather!.type, ["string", "null"]);
    assert.equal(schema.properties.trending!.type, "array");
    assert.match(String(body.input), /^It is Saturday, October 24, 2026\. /);
    assert.match(String(body.input), /today's Austin weather/);
    assert.equal(opts?.timeoutMs, 25_000);
    assert.equal(opts?.label, "worldContext");

    assert.equal(ctx.trending.length, 8);
    assert.equal(ctx.trending[0], "new Zelda trailer");
    assert.ok(ctx.trending.every((s) => typeof s === "string" && s.length > 0 && s.length <= 120));
    assert.equal(ctx.trending.filter((s) => s.toLowerCase() === "new zelda trailer").length, 1, "deduped");
    assert.ok(ctx.trending[1]!.startsWith("word word") && ctx.trending[1]!.length <= 120, "truncated");
    assert.equal(ctx.trending[2], "Astros win", "citation stripped");
    assert.equal(ctx.trending[3], "see this meme everywhere", "link label kept");
    assert.deepEqual(ctx.news, ["Nintendo teases a new console"]);
    assert.deepEqual(ctx.local, []);
    assert.ok(ctx.weather && ctx.weather.length <= 80);
    assert.deepEqual(ctx.hacktx, HACKTX_FACTS);
    assert.equal(ctx.fetchedAt, NOW);

    // One log line, counts only.
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /^\[world\] refreshed in \d+ms \(8 trending, 1 news, 0 local, weather yes\)$/);
  });

  test("asks for light topics only and drops political or heavy items that slip through", async () => {
    fakeResponses(() => ({
      trending: ["Taylor Swift album at #1", "Star Wars trailer drops", "Midterms Nov 3, early votes cast"],
      news: ["Trump cutting Canada tariffs", "Judge limits voting probes in 9 states", "Wemby game-winning shot"],
      local: ["Texas vs Ole Miss at DKR", "Senate race heats up in Austin"],
      weather: "sunny, mid 80s",
    }));
    const ctx = await getWorldContext();
    assert.match(String(seen[0]!.body.input), /Nothing about politics, elections, crime, disasters/);
    assert.deepEqual(ctx.trending, ["Taylor Swift album at #1", "Star Wars trailer drops"]);
    assert.deepEqual(ctx.news, ["Wemby game-winning shot"]);
    assert.deepEqual(ctx.local, ["Texas vs Ole Miss at DKR"]);
  });

  test("accepts a JSON string or a raw Responses object with output_text", async () => {
    fakeResponses((n) => (n === 0 ? JSON.stringify(GOOD) : { output_text: JSON.stringify(GOOD), output: [] }));
    const a = await getWorldContext();
    assert.deepEqual(a.trending, GOOD.trending);

    resetWorldContextForTests();
    const b = await getWorldContext();
    assert.deepEqual(b.local, GOOD.local);
    assert.equal(b.weather, GOOD.weather);
    assert.equal(seen.length, 2);
  });

  test("concurrent callers share one in-flight call", async () => {
    const d = deferred<unknown>();
    fakeResponses(() => d.promise);
    const all = Promise.all([getWorldContext(), getWorldContext(), getWorldContext()]);
    await flush();
    assert.equal(seen.length, 1);
    d.resolve(GOOD);
    const [a, b, c] = await all;
    assert.equal(seen.length, 1);
    assert.equal(a, b);
    assert.equal(b, c);
    assert.deepEqual(a.trending, GOOD.trending);
  });

  test("fresh cache: no second call", async () => {
    fakeResponses(() => GOOD);
    const a = await getWorldContext();
    mock.timers.tick(59 * MIN);
    const b = await getWorldContext();
    await flush();
    assert.equal(seen.length, 1);
    assert.equal(a, b);
  });

  test("expired cache: returns stale at once and starts exactly one background refresh", async () => {
    const second = deferred<unknown>();
    fakeResponses((n) => (n === 0 ? GOOD : second.promise));
    const first = await getWorldContext();
    mock.timers.tick(61 * MIN);

    const stale1 = await getWorldContext(); // resolves although the refresh is still pending
    const stale2 = await getWorldContext();
    await flush();
    assert.equal(stale1, first);
    assert.equal(stale2, first);
    assert.equal(seen.length, 2, "one background refresh");

    second.resolve({ ...GOOD, trending: ["fresh topic"] });
    await flush();
    const fresh = await getWorldContext();
    assert.deepEqual(fresh.trending, ["fresh topic"]);
    assert.equal(fresh.fetchedAt, NOW + 61 * MIN);
    assert.equal(seen.length, 2);
  });

  test("TTL comes from WORLD_CONTEXT_TTL_MS, read at call time", async () => {
    fakeResponses(() => GOOD);
    await getWorldContext();
    process.env.WORLD_CONTEXT_TTL_MS = "1000";
    mock.timers.tick(1500);
    await getWorldContext();
    await flush();
    assert.equal(seen.length, 2);
  });

  test("failure with nothing cached: fallback, then no new call for 5 min", async () => {
    fakeResponses((n) => {
      if (n === 0) throw new Error("boom");
      return GOOD;
    });

    const fb = await getWorldContext();
    assert.deepEqual(
      { trending: fb.trending, news: fb.news, local: fb.local, weather: fb.weather },
      { trending: [], news: [], local: [], weather: null },
    );
    assert.deepEqual(fb.hacktx, HACKTX_FACTS);
    assert.equal(typeof fb.fetchedAt, "number");
    assert.equal(seen.length, 1);
    assert.match(logs.at(-1)!, /^\[world\] fetch failed \(Error\) after \d+ms - using fallback for 5 min$/);

    mock.timers.tick(4 * MIN);
    assert.equal(await getWorldContext(), fb);
    await flush();
    assert.equal(seen.length, 1, "backoff: no refetch within 5 min");

    mock.timers.tick(2 * MIN);
    assert.equal(await getWorldContext(), fb, "still serves fallback while refreshing");
    await flush();
    assert.equal(seen.length, 2, "refetched after 5 min");
    assert.deepEqual((await getWorldContext()).trending, GOOD.trending);
  });

  test("failure with an older good value keeps serving it", async () => {
    fakeResponses((n) => {
      if (n === 1) return Promise.reject(Object.assign(new Error("rate"), { name: "RateCapError" }));
      return GOOD;
    });
    const good = await getWorldContext();
    mock.timers.tick(61 * MIN);

    assert.equal(await getWorldContext(), good);
    await flush();
    assert.equal(seen.length, 2);
    assert.match(logs.at(-1)!, /fetch failed \(RateCapError\).*using stale for 5 min/);

    mock.timers.tick(4 * MIN);
    assert.equal(await getWorldContext(), good);
    await flush();
    assert.equal(seen.length, 2, "backoff");

    mock.timers.tick(2 * MIN);
    assert.equal(await getWorldContext(), good);
    await flush();
    assert.equal(seen.length, 3);
  });

  test("an all-empty result counts as a failure (backoff applies)", async () => {
    fakeResponses(() => ({ trending: [], news: [" "], local: [7], weather: null }));
    const fb = await getWorldContext();
    assert.deepEqual(fb.trending, []);
    assert.equal(fb.weather, null);
    assert.match(logs.at(-1)!, /fetch failed \(EmptyResult\)/);
    mock.timers.tick(MIN);
    await getWorldContext();
    await flush();
    assert.equal(seen.length, 1);
  });

  test("a hung call times out via the safety net and aborts the request", async () => {
    fakeResponses(() => new Promise(() => {}));
    const p = getWorldContext();
    await flush();
    mock.timers.tick(27_000);
    const fb = await p;
    assert.deepEqual(fb.trending, []);
    assert.equal(seen[0]!.opts?.signal?.aborted, true);
    assert.match(logs.at(-1)!, /fetch failed \(TimeoutError\)/);
  });

  test("logs never contain world content", async () => {
    fakeResponses(() => ({ ...GOOD, trending: ["SECRETTOPIC"], weather: "SECRETWEATHER" }));
    await getWorldContext();
    assert.ok(logs.length > 0);
    assert.ok(logs.every((l) => !l.includes("SECRET")));
  });
});

// ── persona factory ──────────────────────────────────────────────────────────

const WORLD: WorldContext = {
  fetchedAt: 1,
  trending: ["t"],
  news: ["n"],
  local: ["l"],
  weather: "nice",
  hacktx: HACKTX_FACTS,
};

const GENERATED: Persona = {
  ...fallbackPersona(),
  age: 19,
  school: "UT Austin",
  year: "sophomore",
  major: "computer science",
  hometown: "Plano",
  blurb: "sophomore CS student from Plano",
};

const FALLBACK: Persona = { ...GENERATED, blurb: "junior ECE student from Waco" };

const fakeCall: MuseCall = async <T>() => ({}) as T;

function deps(over: Partial<PersonaDeps> = {}) {
  const callForArgs: { roomCode: string; signal?: AbortSignal }[] = [];
  const gotCalls: MuseCall[] = [];
  const counts = { world: 0, generate: 0, fallback: 0 };
  const d: PersonaDeps = {
    getWorldContext: async () => {
      counts.world++;
      return WORLD;
    },
    generatePersona: async (world, call) => {
      counts.generate++;
      assert.equal(world, WORLD);
      gotCalls.push(call);
      return structuredClone(GENERATED);
    },
    fallbackPersona: () => {
      counts.fallback++;
      return structuredClone(FALLBACK);
    },
    callFor: (roomCode, signal) => {
      callForArgs.push({ roomCode, signal });
      return fakeCall;
    },
    ...over,
  };
  return { d, callForArgs, gotCalls, counts };
}

describe("makePrepareAiPersona", () => {
  beforeEach(() => captureLogs());
  afterEach(() => mock.restoreAll());

  test("success: generated persona, callFor got the roomCode, one log line without content", async () => {
    const { d, callForArgs, gotCalls, counts } = deps();
    const p = await makePrepareAiPersona(d)({ roomCode: "ABCD" });
    assert.deepEqual(p, GENERATED);
    assert.equal(callForArgs.length, 1);
    assert.equal(callForArgs[0]!.roomCode, "ABCD");
    assert.ok(callForArgs[0]!.signal instanceof AbortSignal);
    assert.equal(gotCalls[0], fakeCall, "generatePersona got the call callFor returned");
    assert.equal(counts.fallback, 0);
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /^\[ai ABCD\] persona ready in \d+ms \(generated\)$/);
    assert.ok(!logs[0]!.includes(GENERATED.blurb));
  });

  test("a complete nonstudent persona needs neither education nor a style section", async () => {
    const nonstudent = fallbackPersona();
    delete nonstudent.school;
    delete nonstudent.year;
    delete nonstudent.major;
    const { d, counts } = deps({ generatePersona: async () => nonstudent });
    const p = await makePrepareAiPersona(d)({ roomCode: "ABCD" });
    assert.deepEqual(p, nonstudent);
    assert.equal(counts.fallback, 0);
    assert.equal("style" in p, false);
    assert.equal("name" in p, false);
  });

  test("generatePersona rejects → fallback", async () => {
    const { d, counts } = deps({ generatePersona: async () => Promise.reject(new SyntaxError("bad json")) });
    const p = await makePrepareAiPersona(d)({ roomCode: "ABCD" });
    assert.equal(p.blurb, FALLBACK.blurb);
    assert.equal(counts.fallback, 1);
    assert.match(logs[0]!, /\(fallback: SyntaxError\)$/);
  });

  test("generatePersona hangs → fallback after timeoutMs, and the Muse signal is aborted", async () => {
    const { d, callForArgs } = deps({
      generatePersona: () => new Promise(() => {}),
      timeoutMs: 30,
    });
    // generatePersona never calls callFor's result here, but callFor still runs first.
    const started = Date.now();
    const p = await makePrepareAiPersona(d)({ roomCode: "ABCD" });
    assert.equal(p.blurb, FALLBACK.blurb);
    assert.ok(Date.now() - started < 1000);
    assert.equal(callForArgs[0]!.signal?.aborted, true);
    assert.match(logs[0]!, /\(fallback: TimeoutError\)$/);
  });

  test("already-aborted signal → fallback without any work", async () => {
    const { d, counts } = deps();
    const ac = new AbortController();
    ac.abort();
    const p = await makePrepareAiPersona(d)({ roomCode: "ABCD", signal: ac.signal });
    assert.equal(p.blurb, FALLBACK.blurb);
    assert.deepEqual(counts, { world: 0, generate: 0, fallback: 1 });
    assert.match(logs[0]!, /\(fallback: AbortedError\)$/);
  });

  test("abort mid-generation → fallback promptly, abort reaches the Muse call", async () => {
    const ac = new AbortController();
    const { d, callForArgs } = deps({
      generatePersona: () => {
        setTimeout(() => ac.abort(), 5);
        return new Promise(() => {});
      },
    });
    const p = await makePrepareAiPersona(d)({ roomCode: "ABCD", signal: ac.signal });
    assert.equal(p.blurb, FALLBACK.blurb);
    assert.equal(callForArgs[0]!.signal?.aborted, true);
  });

  test("unusable or legacy persona → fallback", async () => {
    for (const bad of [
      { ...GENERATED, blurb: "  " },
      { ...GENERATED, blurb: undefined },
      { ...GENERATED, style: { casing: "lowercase" } },
      { ...GENERATED, name: "Legacy name" },
      null,
      "Jordan",
    ]) {
      const { d } = deps({ generatePersona: async () => bad as unknown as Persona });
      const p = await makePrepareAiPersona(d)({ roomCode: "ABCD" });
      assert.equal(p.blurb, FALLBACK.blurb);
    }
    assert.ok(logs.every((l) => l.endsWith("(fallback: unusable)")));
  });

  test("missing or junk arrays use a complete fallback instead of a partial persona", async () => {
    const partial = {
      ...GENERATED,
      interests: undefined,
      opinions: "hot take",
      facts: ["ok", 3, null],
      thisWeek: null,
    };
    const { d } = deps({ generatePersona: async () => partial as unknown as Persona });
    const p = await makePrepareAiPersona(d)({ roomCode: "ABCD" });
    assert.equal(p.blurb, FALLBACK.blurb);
    assert.ok(p.interests.length >= 2);
    assert.ok(p.facts.length >= 8);
    assert.equal("style" in p, false);
  });

  test("getWorldContext rejecting → fallback", async () => {
    const { d, counts } = deps({ getWorldContext: async () => Promise.reject(new Error("x")) });
    const p = await makePrepareAiPersona(d)({ roomCode: "ABCD" });
    assert.equal(p.blurb, FALLBACK.blurb);
    assert.equal(counts.generate, 0);
  });

  test("fallbackPersona throwing still resolves with a usable persona", async () => {
    const { d } = deps({
      generatePersona: async () => Promise.reject(new Error("x")),
      fallbackPersona: () => {
        throw new Error("pool empty");
      },
    });
    const p = await makePrepareAiPersona(d)({ roomCode: "ABCD" });
    assert.ok(p.blurb.length > 0);
    assert.ok(p.interests.length >= 2 && p.facts.length >= 8);
    assert.equal("name" in p, false);
    assert.equal("style" in p, false);
    assert.match(logs[0]!, /\(fallback: Error, last resort\)$/);
  });
});

// ── wiring of the real export (world context + Part 2 + museCallFor), all faked ──

describe("prepareAiPersona (wired)", () => {
  beforeEach(() => {
    resetWorldContextForTests();
    seen = [];
    captureLogs();
  });
  afterEach(() => {
    mock.restoreAll();
    setMuseResponsesForTests(null);
    setMuseCallForTests(null);
    resetWorldContextForTests();
  });

  test("uses the cached world context and the room's Muse call; resolves with a usable persona", async () => {
    fakeResponses(() => GOOD);
    const callOpts: unknown[] = [];
    const call = async (_req: unknown, opts?: { roomCode?: string }) => {
      callOpts.push(opts);
      return structuredClone(GENERATED);
    };
    setMuseCallForTests(call as unknown as CallFn);

    const p = await prepareAiPersona({ roomCode: "WXYZ" });
    assert.ok(Number.isInteger(p.age));
    assert.ok(typeof p.blurb === "string" && p.blurb.trim().length > 0);
    assert.equal(seen.length, 1, "one world-context call");
    assert.ok(callOpts.length >= 1, "persona generation went through Muse");
    for (const o of callOpts) assert.equal((o as { roomCode?: string }).roomCode, "WXYZ");
    assert.ok(callOpts.every((o) => (o as { label?: string }).label === "persona"), "persona calls are labeled");
  });

  test("with Muse failing everywhere it still resolves with a persona", async () => {
    fakeResponses(() => Promise.reject(new Error("down")));
    setMuseCallForTests((async () => Promise.reject(new Error("down"))) as unknown as CallFn);
    const p = await prepareAiPersona({ roomCode: "WXYZ" });
    assert.ok(p.blurb.trim().length > 0);
  });
});
