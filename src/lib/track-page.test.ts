import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { VERDICT_WORDS } from "./facts";
import { BANNED_TRACK_WORDS, type StoredItem } from "./track";
import { filterBySource, formatMedian, trackState } from "./track-page";

const item = (source: string, id = "a".repeat(64)): StoredItem => ({
  id, source, kind: "Upgraded", text: "Proxy implementation changed.", evidence: ["0x" + "1".repeat(40)],
  observedAt: "2026-10-01", alertTime: "2026-10-01T10:00:00Z", blockTime: "2026-10-01T09:59:00Z", publishedAt: "2026-10-02T10:00:00Z",
});
const stats = { published30: 2, retracted30: 0, medianSeconds30: 60 };

describe("trackState", () => {
  test("loading until answered", () => expect(trackState(null)).toEqual({ kind: "loading" }));
  test("valid 200 is ready", () => {
    const items = [item("github:a/b")];
    expect(trackState({ status: 200, body: { watching: 4, updatedAt: "x", stats, items } })).toEqual({ kind: "ready", watching: 4, stats, items });
  });
  test("200 with a bad body is an error", () => {
    expect(trackState({ status: 200, body: null }).kind).toBe("error");
    expect(trackState({ status: 200, body: { watching: 1, stats, items: "no" } }).kind).toBe("error");
    expect(trackState({ status: 200, body: { watching: "1", stats, items: [] } }).kind).toBe("error");
  });
  test("0, 429 and 5xx are errors", () => {
    for (const status of [0, 429, 503]) expect(trackState({ status, body: {} }).kind).toBe("error");
  });
  test("other statuses are errors too", () => expect(trackState({ status: 404, body: {} }).kind).toBe("error"));
});

describe("formatMedian", () => {
  test("formats", () => {
    expect(formatMedian(null)).toBe("—");
    expect(formatMedian(45)).toBe("45 s");
    expect(formatMedian(360)).toBe("6 min");
    expect(formatMedian(7500)).toBe("2 h 5 min");
    expect(formatMedian(7200)).toBe("2 h");
  });
});

describe("filterBySource", () => {
  const items = [item("github:a/b", "1".repeat(64)), item("domain:x.io", "2".repeat(64))];
  test("filters or passes through", () => {
    expect(filterBySource(items, null)).toHaveLength(2);
    expect(filterBySource(items, "domain:x.io").map((i) => i.source)).toEqual(["domain:x.io"]);
  });
});

describe("page copy", () => {
  const src = readFileSync(new URL("../components/track/TrackRecordPage.tsx", import.meta.url), "utf8");
  test("no verdict or banned words", () => {
    for (const w of [...VERDICT_WORDS, ...BANNED_TRACK_WORDS]) expect(src, w).not.toMatch(new RegExp(`\\b${w.replace(" ", "\\s+")}\\b`, "i"));
  });
  test("every href is evidenceHref, projectHref, relative or https", () => {
    const hrefs = [...src.matchAll(/href=(\{[^}]*\}|"[^"]*")/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h, h).toMatch(/^(\{(evidenceHref|projectHref)\(|"(\/|https:\/\/))/);
  });
});
