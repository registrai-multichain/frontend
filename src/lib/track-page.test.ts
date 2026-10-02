import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { View } from "../components/track/TrackRecordPage";
import { VERDICT_WORDS } from "./facts";
import { BANNED_TRACK_WORDS, type StoredItem } from "./track";
import { filterBySource, formatMedian, trackState, type TrackState } from "./track-page";

const item = (source: string, id = "a".repeat(64)): StoredItem => ({
  id, source, kind: "Upgraded", text: "Proxy implementation changed.", evidence: ["0x" + "1".repeat(40)],
  observedAt: "2026-10-01", alertTime: "2026-10-01T10:00:00Z", blockTime: "2026-10-01T09:59:00Z", publishedAt: "2026-10-02T10:00:00Z",
});
const stats = { published30: 2, retracted30: 0, medianSeconds30: 60 };

describe("trackState", () => {
  test("loading until answered", () => expect(trackState(null)).toEqual({ kind: "loading" }));
  test("valid 200 is ready", () => {
    const items = [item("github:a/b")];
    expect(trackState({ status: 200, body: { watching: 4, updatedAt: "2026-10-02T10:00:00.000Z", stats, items } })).toEqual({ kind: "ready", watching: 4, updatedAt: "2026-10-02T10:00:00.000Z", stats, items });
  });
  test("updatedAt is null when the radar has never published (or it is not a time)", () => {
    for (const updatedAt of [undefined, null, "x", 5]) {
      const st = trackState({ status: 200, body: { watching: 0, updatedAt, stats, items: [] } });
      expect(st.kind === "ready" && st.updatedAt, String(updatedAt)).toBeNull();
    }
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

type Ready = Extract<TrackState, { kind: "ready" }>;
const ready = (over: Partial<Ready> = {}): Ready => ({ kind: "ready", watching: 0, updatedAt: null, stats, items: [], ...over });
const view = (state: Ready, source: string | null = null) => renderToStaticMarkup(createElement(View, { state, source }));

describe("track record view", () => {
  test("projects watched is a dash until the radar has published once (no false 0)", () => {
    const html = view(ready({ watching: 0, updatedAt: null }));
    expect(html).toMatch(/>—<\/div><div class="pa-muted pa-small">Projects watched<\/div>/);
    expect(html).not.toMatch(/>0<\/div><div class="pa-muted pa-small">Projects watched/);
  });
  test("projects watched carries its as-of date", () => {
    const html = view(ready({ watching: 12, updatedAt: "2026-10-02T10:00:00.000Z" }));
    expect(html).toMatch(/>12<\/div><div class="pa-muted pa-small">Projects watched as of 2026-10-02<\/div>/);
  });
  test("unfiltered and empty: nothing published yet", () => {
    const html = view(ready());
    expect(html).toContain("Nothing published yet.");
    expect(html).not.toContain("All projects");
  });
  test("filtered to a project with no items: says so for the project, stats labelled all projects", () => {
    const html = view(ready({ items: [item("github:a/b")] }), "domain:x.io");
    expect(html).toContain("Nothing published for this project yet.");
    expect(html).not.toContain("Nothing published yet.");
    const label = html.indexOf(">All projects<");
    expect(label).toBeGreaterThan(-1);
    expect(label).toBeLessThan(html.indexOf("Projects watched"));
  });
});

describe("track record lede", () => {
  const LEDE = "Radar alerts that pass our publication rules appear here at least 24 hours after the alert, with evidence. Security findings and alerts we hold are not published here. Retracted entries stay listed with the reason.";
  test("page and metadata say what is and is not published", () => {
    const page = readFileSync(new URL("../components/track/TrackRecordPage.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
    const route = readFileSync(new URL("../app/track-record/page.tsx", import.meta.url), "utf8");
    expect(page).toContain(LEDE);
    expect(route).toContain(`description: "${LEDE}"`);
    expect(page).not.toContain("published 24 hours after each change");
  });
});
