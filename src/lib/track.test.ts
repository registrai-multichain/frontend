import { describe, expect, it } from "vitest";
import { describesOnly, mergeMonth, monthKey, PUBLIC_KINDS, trackStats, validateBatch, type TrackItem } from "./track";

const C = "0x" + "c1".repeat(20);
const TX = "0x" + "ab".repeat(32);
const item = (o: Partial<TrackItem> = {}): TrackItem => ({
  id: "a".repeat(64), source: "domain:alpha.xyz", kind: "Upgraded",
  text: `At block 150, ${C} was upgraded to implementation ${C}.`, evidence: [C, TX],
  observedAt: "2026-10-02", alertTime: "2026-10-02T10:00:00Z", blockTime: "2026-10-02T09:58:00Z", ...o,
});

describe("validateBatch", () => {
  it("accepts a valid batch", () => {
    const r = validateBatch({ watching: 19, items: [item()] });
    expect(r.ok && r.items.length === 1 && r.watching === 19).toBe(true);
  });
  it("accepts null blockTime", () => {
    expect(validateBatch({ watching: 1, items: [item({ blockTime: null })] }).ok).toBe(true);
  });
  it("rejects non-public kinds, verdicts, bad evidence, bad ids and oversize", () => {
    for (const bad of [
      { kind: "site-new-target" }, { kind: "leak" },
      { text: `${C} is a scam.` }, { text: "The owner stopped it." }, { evidence: ["javascript:alert(1)"] }, { evidence: [] },
      { id: "xyz" }, { source: "Not canonical" }, { text: "x".repeat(301) }, { blockTime: "yesterday" },
    ] as Partial<TrackItem>[]) {
      expect(validateBatch({ watching: 1, items: [item(bad)] }).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(validateBatch({ watching: 1, items: Array.from({ length: 51 }, (_, i) => item({ id: String(i).padStart(64, "0") })) }).ok).toBe(false);
    expect(validateBatch({ watching: -1, items: [] }).ok).toBe(false);
  });
  it("lists exactly the public kinds", () => {
    expect(PUBLIC_KINDS).toContain("control-map");
    expect(PUBLIC_KINDS).not.toContain("site-new-target");
    expect(PUBLIC_KINDS.length).toBe(24);
  });
});

describe("month storage + stats", () => {
  it("monthKey", () => expect(monthKey("2026-10-02T10:00:00Z")).toBe("track:2026-10"));
  it("mergeMonth dedupes and caps", () => {
    const one = mergeMonth([], [item()], "2026-10-03T10:00:00Z");
    expect(mergeMonth(one, [item()], "2026-10-04T10:00:00Z")).toHaveLength(1);
    const many = Array.from({ length: 2001 }, (_, i) => item({ id: i.toString(16).padStart(64, "0") }));
    const m = mergeMonth([], many, "2026-10-03T10:00:00Z");
    expect(m).toHaveLength(2000);
    expect(m[0].id).toBe((1).toString(16).padStart(64, "0"));
  });
  it("trackStats median over 30 days, retracted counted", () => {
    const now = Date.parse("2026-10-10T00:00:00Z");
    const s = mergeMonth([], [
      item({ id: "1".padStart(64, "0"), blockTime: "2026-10-02T09:58:00Z", alertTime: "2026-10-02T10:00:00Z" }),
      item({ id: "2".padStart(64, "0"), blockTime: "2026-10-02T09:50:00Z", alertTime: "2026-10-02T10:00:00Z" }),
      item({ id: "3".padStart(64, "0"), blockTime: null }),
    ], "2026-10-03T00:00:00Z");
    s[2].retracted = { at: "2026-10-04T00:00:00Z", reason: "wrong contract" };
    expect(trackStats(s, now)).toEqual({ published30: 3, retracted30: 1, medianSeconds30: 360 });
  });
});

describe("describesOnly", () => {
  it("rejects verdict and banned words, accepts plain description", () => {
    expect(describesOnly("scam alert was wrong")).toBe(false);
    expect(describesOnly("Ownership moved to a new address.")).toBe(true);
    expect(describesOnly("the Rug moved")).toBe(false);
    expect(describesOnly("a rugby match")).toBe(true);
  });
});

describe("validateBatch alertTime sanity", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  it("rejects an alertTime more than 1 day after now", () => {
    expect(validateBatch({ watching: 1, items: [item({ alertTime: "2026-10-04T12:00:00Z" })] }, now).ok).toBe(false);
    expect(validateBatch({ watching: 1, items: [item({ alertTime: "2026-10-03T11:00:00Z" })] }, now).ok).toBe(true);
  });
});
