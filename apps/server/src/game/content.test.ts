import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContentStore, loadContent } from "./content.js";

const writeBank = (bank: unknown) => {
  const file = join(mkdtempSync(join(tmpdir(), "bank-")), "bank.json");
  writeFileSync(file, JSON.stringify(bank));
  return file;
};
const q = (id: string) => ({ id, text: `question ${id}` });
const baseBank = {
  rounds: ["light", "personal", "collab"],
  tiers: { light: [q("L1"), q("L2")], personal: [q("P1")], deep: [q("D1")] },
  collab: [{ id: "C1", text: "Talk about: {deep}", submitPrompt: "One line" }],
};

describe("content", () => {
  test("the real question bank loads and validates", () => {
    const c = loadContent();
    assert.ok(c.bank.tiers.light.length > 0 && c.bank.collab.length > 0);
    for (const card of c.bank.collab) assert.ok(card.submitPrompt.length <= 140, `${card.id} submitPrompt too long`);
  });

  test("rejects an invalid bank", () => {
    assert.throws(() => loadContent(writeBank({ ...baseBank, collab: [{ id: "C1", text: "x" }] })), /invalid/);
    assert.throws(() => loadContent(writeBank({ ...baseBank, rounds: ["light"] })), /invalid/);
  });

  test("rejects duplicate ids", () => {
    const dupe = { ...baseBank, tiers: { ...baseBank.tiers, personal: [q("L1")] } };
    assert.throws(() => loadContent(writeBank(dupe)), /duplicate ids: L1/);
  });

  test("no repeats until a tier is exhausted, then reuse", () => {
    const c = new ContentStore(loadContent(writeBank(baseBank)).bank);
    const used = new Set<string>();
    const first = [c.pickQuestion("light", used).id, c.pickQuestion("light", used).id].sort();
    assert.deepEqual(first, ["L1", "L2"]);
    assert.ok(["L1", "L2"].includes(c.pickQuestion("light", used).id), "falls back to reuse");
  });

  test("collab cards get {deep} substituted", () => {
    const c = loadContent(writeBank(baseBank));
    const { card, prompt } = c.pickCollab(new Set());
    assert.equal(card.id, "C1");
    assert.equal(prompt, "Talk about: question D1");
  });
});
