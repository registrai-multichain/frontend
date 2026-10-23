import { describe, expect, test } from "vitest";
import { GONE_DARK, goneDarkDate, goneDarkOf } from "./gone-dark";

describe("gone dark records", () => {
  test("cooka is recorded with its date, reason and evidence", () => {
    const r = goneDarkOf("domain:cooka.fun");
    expect(r?.since).toBe("2026-09-27");
    expect(r?.reason).toBe("X account deleted, site offline");
    expect(r?.evidence.map((e) => e.url)).toEqual(["https://x.com/cookafun", "https://cooka.fun"]);
  });
  test("other sources and empty input: null", () => {
    expect(goneDarkOf("domain:kairo.market")).toBeNull();
    expect(goneDarkOf(undefined)).toBeNull();
    expect(goneDarkOf("")).toBeNull();
  });
  test("every record: an ISO date, a reason, https evidence", () => {
    for (const r of Object.values(GONE_DARK)) {
      expect(r.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.reason.length).toBeGreaterThan(0);
      for (const e of r.evidence) expect(e.url).toMatch(/^https:\/\//);
    }
  });
  test("date words without time-zone drift", () => {
    expect(goneDarkDate("2026-09-27")).toBe("27 Sep 2026");
    expect(goneDarkDate("2026-01-01")).toBe("1 Jan 2026");
  });
});
