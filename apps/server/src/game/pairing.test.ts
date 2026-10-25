import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { MatchmakerOutput } from "@game/shared";
import { applyPairing, isValidPairing, randomPairing } from "./pairing.js";
import { validMatch } from "./testkit.js";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `h${i}`);
const AI = "ai";

describe("applyPairing", () => {
  for (const n of [3, 4, 5, 6]) {
    test(`${n} humans: everyone seated exactly once, AI by the odd/even rule`, () => {
      for (let run = 0; run < 50; run++) {
        const humans = ids(n);
        const out = run % 2 === 0 ? validMatch(humans) : null; // matchmaker output, then random fallback
        const pairs = applyPairing(out, humans, AI);
        const all = pairs.flatMap((p) => p.members);
        assert.equal(all.length, n + 1);
        assert.equal(new Set(all).size, n + 1, "no duplicates");
        for (const h of humans) assert.ok(all.includes(h));
        const aiPair = pairs.find((p) => p.members.includes(AI))!;
        if (n % 2 === 1) {
          assert.equal(aiPair.members.length, 2, "odd: AI paired with the leftover");
          assert.ok(pairs.every((p) => p.members.length === 2));
        } else {
          assert.equal(aiPair.members.length, 3, "even: AI makes a trio");
          assert.equal(pairs.filter((p) => p.members.length === 3).length, 1);
        }
        assert.equal(new Set(pairs.map((p) => p.id)).size, pairs.length, "unique pair ids");
      }
    });
  }

  test("uses the matchmaker's pairs when valid", () => {
    const humans = ids(4);
    const out = validMatch(humans); // [h0,h1],[h2,h3]
    const pairs = applyPairing(out, humans, AI);
    const humanSets = pairs.map((p) => p.members.filter((m) => m !== AI).sort().join(","));
    assert.deepEqual(humanSets.sort(), ["h0,h1", "h2,h3"]);
  });

  test("AI position within pairs is shuffled (not always last)", () => {
    const positions = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const pairs = applyPairing(null, ids(4), AI);
      const trio = pairs.find((p) => p.members.includes(AI))!;
      positions.add(trio.members.indexOf(AI));
    }
    assert.equal(positions.size, 3);
  });
});

describe("isValidPairing", () => {
  const humans = ids(5);
  const good: MatchmakerOutput = validMatch(humans);
  test("accepts a valid pairing", () => assert.ok(isValidPairing(good, humans)));
  const bad: [string, unknown][] = [
    ["null", null],
    ["duplicate human", { ...good, humanPairs: [["h0", "h1"], ["h1", "h2"]], leftover: "h4" }],
    ["missing human", { ...good, humanPairs: [["h0", "h1"]], leftover: "h4" }],
    ["unknown id", { ...good, humanPairs: [["h0", "zz"], ["h2", "h3"]], leftover: "h4" }],
    ["pair of 3", { ...good, humanPairs: [["h0", "h1", "h2"], ["h3", "h4"]], leftover: null }],
    ["no leftover with odd count", { ...good, leftover: null }],
    ["leftover also in a pair", { ...good, leftover: "h0" }],
  ];
  for (const [name, out] of bad) {
    test(`rejects: ${name}`, () => assert.equal(isValidPairing(out as MatchmakerOutput, humans), false));
  }
  test("rejects a leftover with an even count", () => {
    const even = ids(4);
    assert.equal(isValidPairing({ ...validMatch(even), leftover: "h0" }, even), false);
  });
  test("randomPairing is always valid", () => {
    for (const n of [3, 4, 5, 6]) for (let i = 0; i < 20; i++) assert.ok(isValidPairing(randomPairing(ids(n)), ids(n)));
  });
});
