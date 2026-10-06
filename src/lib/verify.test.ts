import { describe, expect, test } from "vitest";
import { mergeVerify, validateVerifyInput, type VerifyMap } from "./verify";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const ok = (at: string) => ({ ok: true, at, problems: [] as string[] });

describe("validateVerifyInput", () => {
  const good = { source: "domain:kairo.market", results: { f1: ok("2026-10-06T10:00:00Z") } };
  test("accepts a source or track", () => {
    const r = validateVerifyInput(good, NOW);
    expect(r).toEqual({ ok: true, source: "domain:kairo.market", results: { f1: { ok: true, at: "2026-10-06T10:00:00.000Z", problems: [] } } });
    expect(validateVerifyInput({ source: "track", results: { ["a".repeat(64)]: ok("2026-10-06T10:00:00Z") } }, NOW).ok).toBe(true);
  });
  test("rejects a bad source", () => {
    for (const source of ["Domain:Kairo.Market", "", "nope", 5, "track "]) expect(validateVerifyInput({ ...good, source }, NOW).ok, String(source)).toBe(false);
  });
  test("rejects more than 3 problems or one over 120 characters", () => {
    expect(validateVerifyInput({ ...good, results: { f1: { ok: false, at: "2026-10-06T10:00:00Z", problems: ["a", "b", "c", "d"] } } }, NOW).ok).toBe(false);
    expect(validateVerifyInput({ ...good, results: { f1: { ok: false, at: "2026-10-06T10:00:00Z", problems: ["x".repeat(121)] } } }, NOW).ok).toBe(false);
    expect(validateVerifyInput({ ...good, results: { f1: { ok: false, at: "2026-10-06T10:00:00Z", problems: ["x".repeat(120)] } } }, NOW).ok).toBe(true);
  });
  test("rejects bad ids, non-boolean ok, bad or future times, empty and oversize result sets", () => {
    expect(validateVerifyInput({ ...good, results: { "Bad Id": ok("2026-10-06T10:00:00Z") } }, NOW).ok).toBe(false);
    expect(validateVerifyInput({ ...good, results: { f1: { ok: "yes", at: "2026-10-06T10:00:00Z", problems: [] } } }, NOW).ok).toBe(false);
    expect(validateVerifyInput({ ...good, results: { f1: ok("soon") } }, NOW).ok).toBe(false);
    expect(validateVerifyInput({ ...good, results: { f1: ok("2026-10-07T10:00:00Z") } }, NOW).ok).toBe(false);
    expect(validateVerifyInput({ ...good, results: {} }, NOW).ok).toBe(false);
    expect(validateVerifyInput({ ...good, results: { f1: { ok: true, at: "2026-10-06T10:00:00Z", problems: [1] } } }, NOW).ok).toBe(false);
    expect(validateVerifyInput(null, NOW).ok).toBe(false);
  });
});

describe("mergeVerify", () => {
  test("keeps the latest result per id and tracks lastOk", () => {
    let m: VerifyMap = mergeVerify({}, { f1: ok("2026-10-01T00:00:00.000Z") });
    expect(m.f1).toEqual({ ok: true, at: "2026-10-01T00:00:00.000Z", problems: [], lastOk: "2026-10-01T00:00:00.000Z" });
    m = mergeVerify(m, { f1: { ok: false, at: "2026-10-02T00:00:00.000Z", problems: ["gone"] } });
    expect(m.f1).toEqual({ ok: false, at: "2026-10-02T00:00:00.000Z", problems: ["gone"], lastOk: "2026-10-01T00:00:00.000Z" });
    m = mergeVerify(m, { f1: ok("2026-10-03T00:00:00.000Z"), f2: ok("2026-10-03T00:00:00.000Z") });
    expect(m.f1.lastOk).toBe("2026-10-03T00:00:00.000Z");
    expect(Object.keys(m)).toEqual(["f1", "f2"]);
  });
  test("an older result never replaces a newer one but can still raise lastOk", () => {
    const m = mergeVerify({ f1: { ok: false, at: "2026-10-05T00:00:00.000Z", problems: ["gone"] } }, { f1: ok("2026-10-04T00:00:00.000Z") });
    expect(m.f1).toEqual({ ok: false, at: "2026-10-05T00:00:00.000Z", problems: ["gone"], lastOk: "2026-10-04T00:00:00.000Z" });
  });
  test("does not mutate its input", () => {
    const prev: VerifyMap = { f1: { ...ok("2026-10-01T00:00:00.000Z"), lastOk: "2026-10-01T00:00:00.000Z" } };
    const snap = JSON.stringify(prev);
    mergeVerify(prev, { f1: ok("2026-10-02T00:00:00.000Z") });
    expect(JSON.stringify(prev)).toBe(snap);
  });
});
