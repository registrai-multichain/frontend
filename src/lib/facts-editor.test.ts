import { describe, expect, test } from "vitest";
import { editorDraft, parseDraft } from "./facts-editor";

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
