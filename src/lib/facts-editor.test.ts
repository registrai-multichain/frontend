import { describe, expect, test } from "vitest";
import { boxSource, canonicalSourceInput, editorDraft, factsSources, parseDraft, sourceBox, SOURCE_BOX, type SourceBoxAction } from "./facts-editor";

const SRC = "domain:kairo.market";
describe("facts editor helpers", () => {
  test("round-trips the stored facts through the draft text", () => {
    const stored = { source: SRC, summary: "Prediction markets and a launchpad on Arc.", facts: [], changelog: [], lastReviewedAt: "", reviewedBy: "", rev: 2 };
    const draft = editorDraft(stored);
    expect(JSON.parse(draft)).toEqual({ rev: 2, summary: "Prediction markets and a launchpad on Arc.", facts: [] });
    const p = parseDraft(draft, SRC);
    expect(p.ok && p.value.rev).toBe(2);
  });
  test("reports JSON syntax errors and validation errors in plain words", () => {
    const bad = parseDraft("{ rev: 2", SRC);
    expect(bad.ok === false && bad.error).toMatch(/^not valid JSON/);
    const verdict = parseDraft(JSON.stringify({ rev: 0, facts: [{ id: "a", topic: "control", text: "a scam", evidence: ["https://a.io"], observedAt: "2026-09-29" }] }), SRC);
    expect(verdict.ok).toBe(false);
  });
});

describe("facts sources", () => {
  test("union of the lists, de-duplicated and sorted, ignoring null lists", () => {
    expect(factsSources(["domain:b.io", "github:x/y"], null, new Set(["domain:a.io", "domain:b.io"]), undefined)).toEqual(["domain:a.io", "domain:b.io", "github:x/y"]);
  });
  test("typed input must be canonical", () => {
    expect(canonicalSourceInput("domain:kairo.market")).toEqual({ ok: true, source: "domain:kairo.market" });
    expect(canonicalSourceInput("  domain:kairo.market ")).toEqual({ ok: true, source: "domain:kairo.market" });
    const bad = canonicalSourceInput("https://Kairo.market/");
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toBe("not a canonical source");
    expect(canonicalSourceInput("domain:KAIRO.market").ok).toBe(false);
    expect(canonicalSourceInput("").ok).toBe(false);
  });
});

describe("admin facts source box", () => {
  const run = (...as: SourceBoxAction[]) => as.reduce(sourceBox, SOURCE_BOX);
  test("typing alone never changes the source (no editor remount, no GET per keystroke)", () => {
    for (const partial of ["d", "domain:", "domain:k", "domain:kairo.m", "domain:kairo.market"]) {
      expect(boxSource(run({ type: "type", value: partial }))).toEqual({ source: "", error: "" });
    }
    const picked = run({ type: "pick", value: "github:x/y" }, { type: "type", value: "domain:kairo.market" });
    expect(boxSource(picked).source).toBe("github:x/y");
  });
  test("Enter or blur commits the typed source; a later edit waits for the next commit", () => {
    const s = run({ type: "type", value: "domain:kairo.market" }, { type: "commit" });
    expect(boxSource(s)).toEqual({ source: "domain:kairo.market", error: "" });
    const editing = sourceBox(s, { type: "type", value: "domain:kairo.marke" });
    expect(boxSource(editing).source).toBe("domain:kairo.market");
    const bad = sourceBox(editing, { type: "type", value: "https://Kairo.market/" });
    expect(boxSource(sourceBox(bad, { type: "commit" }))).toEqual({ source: "", error: "not a canonical source" });
  });
  test("picking is immediate and clears the typed source", () => {
    const s = run({ type: "type", value: "domain:kairo.market" }, { type: "commit" }, { type: "pick", value: "github:x/y" });
    expect(s.typed).toBe("");
    expect(boxSource(s)).toEqual({ source: "github:x/y", error: "" });
  });
});
