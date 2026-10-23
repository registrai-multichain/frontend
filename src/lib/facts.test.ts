import { describe, expect, test } from "vitest";
import { diffChangelog, evidenceHref, publicFacts, publicResponse, validateFacts, type Fact, type ProjectFacts } from "./facts";

const SRC = "domain:kairo.market";
const ADDR = "0xdaf97c69eb8fb68ca9f4269eb8c458b3a5a31122";
const TX = "0xe95f4d088a96b698bcc9996a5a00e917a5cd2b1610fb8c62545050710ad7fcd0";
const fact = (over: Partial<Fact> = {}): Fact => ({
  id: "f1", topic: "control", text: "One externally owned account deployed all 16 contracts.",
  evidence: [ADDR], observedAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z", ...over,
});
const body = (facts: unknown[], extra: Record<string, unknown> = {}) => ({ rev: 0, facts, ...extra });

describe("validateFacts", () => {
  test("accepts a neutral, evidenced fact and normalises addresses", () => {
    const r = validateFacts(body([fact({ evidence: [ADDR.toUpperCase().replace("0X", "0x")] })]), SRC);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.facts[0].evidence).toEqual([ADDR]);
  });
  test("rejects verdict words (whole words, any case)", () => {
    for (const t of ["This is a SCAM.", "Liquidity looks risky", "Rugged in 2025", "a red flag here"]) {
      const r = validateFacts(body([fact({ text: t })]), SRC);
      expect(r.ok, t).toBe(false);
    }
    expect(validateFacts(body([fact({ text: "Ownership moved to 0xdaf97c69eb8fb68ca9f4269eb8c458b3a5a31122, a Safe requiring 2 of 3 owner signatures." })]), SRC).ok).toBe(true);
    expect(validateFacts(body([fact({ text: "the contract is safe" })]), SRC).ok).toBe(false);
    expect(validateFacts(body([fact({ text: "SCAM" })]), SRC).ok).toBe(false);
    expect(validateFacts(body([fact({ text: "The safeguard module is enabled." })]), SRC).ok).toBe(true); // "safeguard" is not "safe"
  });
  test("requires 1-5 evidence links, https or 0x only", () => {
    expect(validateFacts(body([fact({ evidence: [] })]), SRC).ok).toBe(false);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://example.com", "https://user:pw@example.com", "ftp://x.y"]) {
      expect(validateFacts(body([fact({ evidence: [bad] })]), SRC).ok, bad).toBe(false);
    }
    expect(validateFacts(body([fact({ evidence: [ADDR, TX, "https://kairo.market/docs"] })]), SRC).ok).toBe(true);
    expect(validateFacts(body([fact({ evidence: Array(6).fill(ADDR) })]), SRC).ok).toBe(false);
  });
  test("rejects unknown topics, duplicate ids, oversize text and too many facts", () => {
    expect(validateFacts(body([fact({ topic: "risk" as never })]), SRC).ok).toBe(false);
    expect(validateFacts(body([fact(), fact()]), SRC).ok).toBe(false);
    expect(validateFacts(body([fact({ text: "x".repeat(301) })]), SRC).ok).toBe(false);
    expect(validateFacts(body(Array.from({ length: 61 }, (_, i) => fact({ id: `f${i}` }))), SRC).ok).toBe(false);
  });
  test("supersededBy must point at another fact in the same set", () => {
    expect(validateFacts(body([fact({ supersededBy: "f9" })]), SRC).ok).toBe(false);
    expect(validateFacts(body([fact({ supersededBy: "f2" }), fact({ id: "f2" })]), SRC).ok).toBe(true);
  });
  test("rev must be a non-negative integer", () => {
    expect(validateFacts({ facts: [] }, SRC).ok).toBe(false);
    expect(validateFacts({ rev: -1, facts: [] }, SRC).ok).toBe(false);
  });
});

describe("publicFacts", () => {
  test("hides facts (and their log entries) until publishAt", () => {
    const now = Date.parse("2026-09-29T00:00:00.000Z");
    const p: ProjectFacts = {
      source: SRC, facts: [fact(), fact({ id: "sec", publishAt: "2026-10-29T00:00:00.000Z" })],
      changelog: [{ at: "2026-09-29T00:00:00.000Z", kind: "added", factId: "sec", text: "x" }, { at: "2026-09-29T00:00:00.000Z", kind: "added", factId: "f1", text: "y" }],
      lastReviewedAt: "2026-09-29T00:00:00.000Z", reviewedBy: "registrai", rev: 3,
    };
    const out = publicFacts(p, now);
    expect(out.facts.map((f) => f.id)).toEqual(["f1"]);
    expect(out.changelog.map((c) => c.factId)).toEqual(["f1"]);
    const later = Date.parse("2026-11-01T00:00:00.000Z");
    expect(publicFacts(p, later).facts).toHaveLength(1); // embargo passed but never re-checked: stays hidden
    expect(publicFacts(p, later, { sec: { ok: true, at: "2026-10-30T00:00:00.000Z", problems: [], lastOk: "2026-10-30T00:00:00.000Z" } }).facts).toHaveLength(2);
  });
  test("a present but null, empty or non-string publishAt / hiddenUntil fails closed", () => {
    const now = Date.parse("2026-11-01T00:00:00.000Z");
    for (const bad of [null, "", 5] as unknown as string[]) {
      const p: ProjectFacts = {
        source: SRC, facts: [fact(), fact({ id: "sec", text: "Private detail.", publishAt: bad })],
        changelog: [
          { at: "2026-09-29T00:00:00.000Z", kind: "removed", factId: "gone", text: "Old private.", hiddenUntil: bad },
          { at: "2026-09-29T00:00:00.000Z", kind: "added", factId: "f1", text: "y" },
        ],
        lastReviewedAt: "2026-09-29T00:00:00.000Z", reviewedBy: "registrai", rev: 3,
      };
      const out = publicFacts(p, now);
      expect(out.facts.map((f) => f.id), String(bad)).toEqual(["f1"]);
      expect(JSON.stringify(out), String(bad)).not.toContain("Private");
      expect(JSON.stringify(out), String(bad)).not.toContain("Old private");
    }
  });
  test("an unparseable publishAt or hiddenUntil fails closed (stays hidden)", () => {
    const now = Date.parse("2026-11-01T00:00:00.000Z");
    const p: ProjectFacts = {
      source: SRC, facts: [fact(), fact({ id: "sec", text: "Private detail.", publishAt: "garbage" })],
      changelog: [
        { at: "2026-09-29T00:00:00.000Z", kind: "added", factId: "sec", text: "Private detail." },
        { at: "2026-09-29T00:00:00.000Z", kind: "removed", factId: "gone", text: "Old private.", hiddenUntil: "garbage" },
        { at: "2026-09-29T00:00:00.000Z", kind: "added", factId: "f1", text: "y" },
      ],
      lastReviewedAt: "2026-09-29T00:00:00.000Z", reviewedBy: "registrai", rev: 3,
    };
    const out = publicFacts(p, now);
    expect(out.facts.map((f) => f.id)).toEqual(["f1"]);
    expect(out.changelog.map((c) => c.factId)).toEqual(["f1"]);
    expect(JSON.stringify(out)).not.toContain("Private");
  });
});

describe("private facts never leak through the change log", () => {
  const at = "2026-09-29T00:00:00.000Z";
  const pub = "2026-10-29T00:00:00.000Z";
  const mk = (changelog: ProjectFacts["changelog"], facts: Fact[]): ProjectFacts => ({ source: SRC, facts, changelog, lastReviewedAt: at, reviewedBy: "r", rev: 1 });
  test("added then removed before publish stays hidden; visible after publish time", () => {
    const priv = fact({ id: "sec", text: "Private detail.", publishAt: pub });
    const log = [...diffChangelog([], [priv], at), ...diffChangelog([priv], [], at)];
    expect(log.map((e) => e.hiddenUntil)).toEqual([pub, pub]);
    expect(publicFacts(mk(log, []), Date.parse(at)).changelog).toEqual([]);
    const later = publicFacts(mk(log, []), Date.parse("2026-11-01T00:00:00.000Z")).changelog;
    expect(later.map((e) => e.kind)).toEqual(["added", "removed"]);
    expect(later.every((e) => !("hiddenUntil" in e))).toBe(true);
  });
  test("visible fact superseded by a private one reveals nothing", () => {
    const priv = fact({ id: "sec", publishAt: pub });
    const prev = [fact()];
    const next = [fact({ supersededBy: "sec" }), priv];
    const out = publicFacts(mk(diffChangelog(prev, next, at), next), Date.parse(at));
    expect(out.facts.map((f) => f.supersededBy)).toEqual([undefined]);
    expect(JSON.stringify(out)).not.toContain("sec");
  });
});

describe("diffChangelog", () => {
  test("added / updated / superseded / note / removed", () => {
    const at = "2026-09-29T00:00:00.000Z";
    const prev = [fact(), fact({ id: "f2", text: "Old." })];
    const next = [
      fact({ supersededBy: "f3", projectNote: { text: "Moving to a multisig.", at } }),
      fact({ id: "f3", text: "Ownership moved to a 2-of-3 Safe." }),
    ];
    const kinds = diffChangelog(prev, next, at).map((e) => `${e.kind}:${e.factId}`).sort();
    expect(kinds).toEqual(["added:f3", "note:f1", "removed:f2", "superseded:f1"]);
    expect(diffChangelog(prev, [fact({ text: "Changed wording." }), prev[1]], at).map((e) => e.kind)).toEqual(["updated"]);
  });
});

describe("evidenceHref", () => {
  test("addresses and tx hashes go to the Arc explorer; https stays", () => {
    expect(evidenceHref(ADDR)).toBe(`https://explorer.arc.io/address/${ADDR}`);
    expect(evidenceHref(TX)).toBe(`https://explorer.arc.io/tx/${TX}`);
    expect(evidenceHref("https://kairo.market")).toBe("https://kairo.market/");
  });
});

describe("publicFacts: embargo gate and verifiedAt", () => {
  const NOW = Date.parse("2026-10-16T12:00:00.000Z");
  const pf = (facts: Fact[]): ProjectFacts => ({ source: SRC, facts, changelog: [{ at: "2026-10-11T00:00:00.000Z", kind: "added", factId: "e1", text: "x" }], lastReviewedAt: "", reviewedBy: "0x1", rev: 1 });
  const embargoed = fact({ id: "e1", publishAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z" });
  const v = (lastOk?: string) => ({ e1: { ok: true, at: lastOk ?? "2026-10-16T00:00:00.000Z", problems: [], ...(lastOk ? { lastOk } : {}) } });
  test("an embargoed fact whose time passed stays hidden without a verify map (fails closed)", () => {
    expect(publicFacts(pf([embargoed]), NOW).facts).toEqual([]);
    expect(publicFacts(pf([embargoed]), NOW, {}).facts).toEqual([]);
    expect(publicFacts(pf([embargoed]), NOW).changelog).toEqual([]);
  });
  test("a pass before updatedAt keeps it hidden; at or after updatedAt releases it", () => {
    expect(publicFacts(pf([embargoed]), NOW, v("2026-10-13T00:00:00.000Z")).facts).toEqual([]);
    expect(publicFacts(pf([embargoed]), NOW, { e1: { ok: false, at: "2026-10-16T00:00:00.000Z", problems: ["x"] } }).facts).toEqual([]);
    expect(publicFacts(pf([embargoed]), NOW, v("2026-10-14T00:00:00.000Z")).facts.map((f) => f.id)).toEqual(["e1"]);
    expect(publicFacts(pf([embargoed]), NOW, v("2026-10-15T10:00:00.000Z")).changelog).toHaveLength(1);
  });
  test("a future publishAt stays hidden even when verified", () => {
    const later = fact({ id: "e1", publishAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z" });
    expect(publicFacts(pf([later]), NOW, v("2026-10-15T10:00:00.000Z")).facts).toEqual([]);
  });
  test("non-embargoed facts are unaffected by the gate and get verifiedAt only when verified", () => {
    const plain = fact({ id: "p1" });
    expect(publicFacts(pf([plain]), NOW).facts).toEqual([plain]);
    const withV = publicFacts(pf([plain]), NOW, { p1: { ok: false, at: "2026-10-15T00:00:00.000Z", problems: ["x"], lastOk: "2026-10-14T00:00:00.000Z" } });
    expect(withV.facts[0].verifiedAt).toBe("2026-10-14T00:00:00.000Z");
    // a pass from before the fact's last update says nothing about its current text
    expect(publicFacts(pf([plain]), NOW, { p1: { ok: true, at: "2026-09-01T00:00:00.000Z", problems: [], lastOk: "2026-09-01T00:00:00.000Z" } }).facts[0]).not.toHaveProperty("verifiedAt");
    expect(publicFacts(pf([plain]), NOW, { p1: { ok: false, at: "2026-10-15T00:00:00.000Z", problems: ["x"] } }).facts[0]).not.toHaveProperty("verifiedAt");
  });
  test("a released embargoed fact carries verifiedAt and no publishAt", () => {
    const f = publicFacts(pf([embargoed]), NOW, v("2026-10-15T10:00:00.000Z")).facts[0];
    expect(f.verifiedAt).toBe("2026-10-15T10:00:00.000Z");
    expect(f).not.toHaveProperty("publishAt");
  });
  test("publicResponse passes verify through", () => {
    const r = publicResponse(pf([embargoed]), NOW, v("2026-10-15T10:00:00.000Z"));
    expect(r.facts[0].verifiedAt).toBe("2026-10-15T10:00:00.000Z");
    expect(publicResponse(pf([embargoed]), NOW).facts).toEqual([]);
  });
});

describe("evidence gate applies only to embargoes ending after it was introduced", () => {
  const mk = (facts: Fact[]): ProjectFacts => ({ source: SRC, facts, changelog: [], lastReviewedAt: "2026-09-29T00:00:00.000Z", reviewedBy: "r", rev: 1 });
  test("a fact released before the gate stays public without any verify result", () => {
    const old = fact({ id: "old", publishAt: "2026-10-01T00:00:00.000Z" });
    expect(publicFacts(mk([old]), Date.parse("2026-10-08T00:00:00.000Z")).facts.map((f) => f.id)).toEqual(["old"]);
  });
  test("an embargo ending after the gate still needs a passing check", () => {
    const sec = fact({ id: "sec", publishAt: "2026-10-31T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" });
    const now = Date.parse("2026-11-01T00:00:00.000Z");
    expect(publicFacts(mk([sec]), now).facts).toEqual([]);
    const ok = { sec: { ok: true, at: "2026-10-31T01:00:00.000Z", problems: [], lastOk: "2026-10-31T01:00:00.000Z" } };
    expect(publicFacts(mk([sec]), now, ok as never).facts.map((f) => f.id)).toEqual(["sec"]);
  });
});
