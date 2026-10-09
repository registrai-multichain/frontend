import { describe, expect, test } from "vitest";
import { ABI_LIMITS, validateIndex, validateSeen } from "./builders-index";
import real from "./fixtures/builders-index.json";
import { indexFixture } from "./builders-index-fixture";

const bad = (mut: (d: Record<string, any>) => void) => { const d = indexFixture(); mut(d); return validateIndex(d); };

describe("validateIndex", () => {
  test("accepts a good file and keeps only the schema's fields", () => {
    const r = validateIndex(indexFixture());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.data).sort()).toEqual(["base", "events", "head_block", "head_time", "index", "index_24h_ago", "params", "projects", "series", "updated", "data_until"].sort());
      expect(r.data.series).toHaveLength(200);
    }
  });
  test("index_24h_ago and share_base may be null", () => {
    expect(bad((d) => { d.index_24h_ago = null; }).ok).toBe(true);
  });
  test.each([
    ["not an object", () => validateIndex([])],
    ["non-ISO time", () => bad((d) => { d.updated = "yesterday"; })],
    ["NaN level", () => bad((d) => { d.index = Number.NaN; })],
    ["Infinity in series", () => bad((d) => { d.series[3][1] = Infinity; })],
    ["string number", () => bad((d) => { d.index = "944" as unknown as number; })],
    ["bad sha", () => bad((d) => { d.base.sha256 = "xyz"; })],
    ["bad series entry", () => bad((d) => { d.series[0] = ["2026-10-02T01:00:00Z"]; })],
    ["fractional head_block", () => bad((d) => { d.head_block = 1.5; })],
    ["bad project", () => bad((d) => { d.projects[0].contracts = -1; })],
    ["bad kind", () => bad((d) => { d.events[0].kind = "other"; })],
    ["missing half life", () => bad((d) => { delete d.params.half_life_days; })],
    ["overlong name", () => bad((d) => { d.projects[0].name = "x".repeat(ABI_LIMITS.str + 1); })],
    ["too many projects", () => bad((d) => { d.projects = Array.from({ length: ABI_LIMITS.projects + 1 }, () => d.projects[1]); })],
    ["too many series points", () => bad((d) => { d.series = Array.from({ length: ABI_LIMITS.series + 1 }, () => d.series[0]); })],
    ["too many events", () => bad((d) => { d.events = Array.from({ length: ABI_LIMITS.events + 1 }, () => d.events[0]); })],
  ])("rejects: %s", (_n, run) => {
    expect(run().ok).toBe(false);
  });
  test("non-numeric params are dropped, not stored", () => {
    const r = bad((d) => { d.params.note = "hi"; d.params.big = Number.NaN; });
    expect(r.ok && Object.keys(r.data.params).includes("note")).toBe(false);
  });
});

describe("the live block", () => {
  test("the real producer file passes, with its live block kept", () => {
    const r = validateIndex(real);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.live?.hour_start).toBe(real.live.hour_start);
      expect(Object.keys(r.data.live!.contracts).length).toBeGreaterThan(100);
      expect(JSON.stringify(r.data).length).toBeLessThan(ABI_LIMITS.bytes);
    }
  });
  const mutate = (f: (l: any) => void) => { const d = JSON.parse(JSON.stringify(real)); f(d.live); return validateIndex(d); };
  test.each([
    ["no hour_start", (l: any) => { delete l.hour_start; }],
    ["NaN K", (l: any) => { l.K = Number.NaN; }],
    ["negative P", (l: any) => { l.P["base:arc"] = -1; }],
    ["bad contract address", (l: any) => { l.contracts["0xNOPE"] = "domain:x"; }],
    ["uppercase address", (l: any) => { l.contracts["0x" + "A".repeat(40)] = "domain:x"; }],
    ["bad deployer", (l: any) => { l.deployers["domain:argus.world"] = ["nope"]; }],
    ["huge base window", (l: any) => { l.base_window = 10 ** 9; }],
    ["zero seen prefix", (l: any) => { l.seen_prefix = 0; }],
  ])("rejects: %s", (_n, f) => {
    expect(mutate(f).ok).toBe(false);
  });
  test("too many contracts is refused", () => {
    expect(mutate((l) => { for (let i = 0; i < ABI_LIMITS.contracts + 1; i++) l.contracts["0x" + i.toString(16).padStart(40, "0")] = "domain:x"; }).ok).toBe(false);
  });
  test("a file without a live block is still valid", () => {
    expect(bad(() => undefined).ok).toBe(true);
  });
});

describe("validateSeen", () => {
  const good = { hour_start: 1791558000, seen: { "domain:argus.world": "0123456789abcdef0123", "domain:empty": "" } };
  test("accepts concatenated 10-hex prefixes", () => {
    expect(validateSeen(good)).toEqual({ ok: true, data: good });
  });
  test.each([
    ["not an object", []],
    ["no hour_start", { seen: {} }],
    ["uppercase hex", { hour_start: 1, seen: { a: "ABCDEF0123" } }],
    ["non-hex", { hour_start: 1, seen: { a: "zzzzzzzzzz" } }],
    ["length not a multiple of 10", { hour_start: 1, seen: { a: "0123456789a" } }],
    ["non-string value", { hour_start: 1, seen: { a: 5 } }],
    ["seen not an object", { hour_start: 1, seen: [] }],
  ])("rejects: %s", (_n, v) => {
    expect(validateSeen(v).ok).toBe(false);
  });
  test("too many sources", () => {
    const seen = Object.fromEntries(Array.from({ length: ABI_LIMITS.seenSources + 1 }, (_, i) => [`s${i}`, ""]));
    expect(validateSeen({ hour_start: 1, seen }).ok).toBe(false);
  });
});
