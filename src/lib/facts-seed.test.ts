import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { validateFacts } from "./facts";

// The seed files live in the main checkout's docs/ (outside git). From the repo root
// the relative path resolves; from a worktree (.worktrees/<name>/) it does not, so set
// FACTS_SEED_DIR there. If neither exists the suite is skipped.
const CANDIDATES = [process.env.FACTS_SEED_DIR, new URL("../../../docs/superpowers/investigations/facts/", import.meta.url).pathname].filter((p): p is string => !!p);
const FOUND = CANDIDATES.find((p) => existsSync(p));
const DIR = (FOUND ?? "").replace(/\/?$/, "/");

describe.skipIf(!FOUND)("seed facts (skipped: set FACTS_SEED_DIR or run from the repo root)", () => {
  const files = FOUND ? readdirSync(DIR).filter((f) => f.endsWith(".json")) : [];
  test("there are seed files", () => expect(files.length).toBeGreaterThanOrEqual(2));
  for (const f of files) {
    test(`${f} validates and has at least 6 facts across 3+ topics`, () => {
      const r = validateFacts(JSON.parse(readFileSync(DIR + f, "utf8")), "domain:seed.test"); // validateFacts does not use the source
      expect(r.ok, r.ok ? "" : r.error).toBe(true);
      if (r.ok) {
        expect(r.value.facts.length).toBeGreaterThanOrEqual(6);
        expect(new Set(r.value.facts.map((x) => x.topic)).size).toBeGreaterThanOrEqual(3);
        for (const fact of r.value.facts) {
          const ev = new Set(fact.evidence);
          for (const a of fact.text.toLowerCase().match(/0x[0-9a-f]{40,64}/g) ?? []) expect(ev.has(a), `${fact.id}: ${a} not in evidence`).toBe(true);
        }
      }
    });
  }
});
