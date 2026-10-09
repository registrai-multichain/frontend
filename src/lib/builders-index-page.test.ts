import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import type { AbiData } from "./builders-index";
import { validateIndex } from "./builders-index";
import { indexFixture } from "./builders-index-fixture";
import { createEngine } from "./abi-live";
import { HB, INDEX, mockRpc, SEEN } from "./abi-live-mock";
import { abiState, activityRows, chartGeometry, dayLabel, fmt, freshness, liveStatus, memberRows, pct, shortHash, sliceSeries, stats, withLive } from "./builders-index-page";

const data = (): AbiData => { const r = validateIndex(indexFixture()); if (!r.ok) throw new Error(r.error); return r.data; };

describe("formatting", () => {
  test("numbers and percents", () => {
    expect(fmt(944.756, 2)).toBe("944.76");
    expect(fmt(21775952, 0)).toBe("21,775,952");
    expect(pct(0.0123)).toBe("+1.23%");
    expect(pct(-0.0518)).toBe("−5.18%");
    expect(dayLabel("2026-10-02T00:00:00Z")).toBe("2 Oct");
    expect(shortHash("a".repeat(64))).toBe(`${"a".repeat(10)}…${"a".repeat(8)}`);
  });
});

describe("range slicing", () => {
  const s = data().series;
  test("24H = last 25 points, 7D = last 169, All = everything", () => {
    expect(sliceSeries(s, "24H")).toHaveLength(25);
    expect(sliceSeries(s, "7D")).toHaveLength(169);
    expect(sliceSeries(s, "All")).toHaveLength(200);
    expect(sliceSeries(s, "24H").at(-1)).toEqual(s.at(-1));
  });
  test("short series come back whole", () => {
    expect(sliceSeries(s.slice(0, 5), "7D")).toHaveLength(5);
  });
});

describe("stats", () => {
  test("index, 24h, since base, base, members, decay, block", () => {
    const st = Object.fromEntries(stats(data()).map((x) => [x.label, x]));
    expect(st.Index.value).toBe("944.76");
    expect(st["24h"]).toMatchObject({ value: "−1.03%", tone: "down" });
    expect(st["Since base"]).toMatchObject({ value: "−5.52%", tone: "down" });
    expect(st.Base.value).toBe("1,000.0 · 2 Oct");
    expect(st.Members.value).toBe("2 + base");
    expect(st.Decay.value).toBe("−0.206% / h");
    expect(st["Arc block"].value).toBe("25,094,458");
  });
  test("no 24h reference reads as a dash", () => {
    const d = { ...data(), index_24h_ago: null };
    expect(stats(d).find((x) => x.label === "24h")?.value).toBe("–");
  });
  test("freshness: delayed after 3 hours", () => {
    const d = data();
    expect(freshness(d, Date.parse("2026-10-09T16:00:00Z")).delayed).toBe(false);
    expect(freshness(d, Date.parse("2026-10-09T19:00:00Z")).delayed).toBe(true);
  });
});

describe("tables", () => {
  test("members: weight now vs at base, change, new member, base layer", () => {
    const rows = memberRows(data());
    expect(rows[0]).toMatchObject({ baseLayer: true, now: "21.1%", atBase: "20.0%", change: "+1.1", contracts: "all" });
    expect(rows[1]).toMatchObject({ now: "18.7%", atBase: "19.5%", change: "−0.8", changeTone: "down", contracts: "12" });
    expect(rows[2]).toMatchObject({ atBase: "–", change: "new", changeTone: "new" });
  });
  test("activity: last 72 h only, newest first, rise-limit rows flagged", () => {
    const rows = activityRows(data());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ hour: "9 Oct 14:00–15:00", what: "48 payments from 1 wallet · 33 new", points: "+180.1" });
    expect(rows[1]).toMatchObject({ limited: true, what: "Rise limit applied", points: "capped" });
  });
});

describe("chart geometry", () => {
  test("keeps the base level inside the y range and ends at the last point", () => {
    const d = data();
    const pts = sliceSeries(d.series, "7D");
    const g = chartGeometry(pts, "7D", 600, 300, d.base.level)!;
    expect(g.baseY).not.toBeNull();
    expect(g.baseY!).toBeGreaterThan(0);
    expect(g.baseY!).toBeLessThan(300);
    expect(g.last.v).toBe(pts.at(-1)![1]);
    expect(g.xs).toHaveLength(pts.length);
    expect(g.path.startsWith("M")).toBe(true);
    expect(chartGeometry([], "All", 600, 300, 1000)).toBeNull();
  });
  test("a flat series does not divide by zero", () => {
    const g = chartGeometry([["2026-10-02T01:00:00Z", 1000], ["2026-10-02T02:00:00Z", 1000]], "All", 600, 300, 1000)!;
    expect(Number.isFinite(g.last.y)).toBe(true);
  });
});

describe("page state", () => {
  test("404 is the empty state, bad bodies are errors, a good body is ready", () => {
    expect(abiState(null).kind).toBe("loading");
    expect(abiState({ status: 404, body: { error: "no data" } }).kind).toBe("empty");
    expect(abiState({ status: 500, body: {} }).kind).toBe("error");
    expect(abiState({ status: 200, body: { nope: 1 } }).kind).toBe("error");
    expect(abiState({ status: 200, body: indexFixture() }).kind).toBe("ready");
  });
});

describe("live view", () => {
  async function live(off: number) {
    const e = createEngine({ call: mockRpc(HB + off) as never });
    e.load(INDEX.live!, SEEN);
    return e.tick();
  }
  test("without a live result the server data is unchanged", () => {
    const d = INDEX;
    expect(withLive(d, null)).toBe(d);
  });
  test("adds the live point, the rolled hours and the open hour's events", async () => {
    const R = await live(7300);
    const v = withLive(INDEX, R);
    expect(v.index).toBe(R.index);
    expect(v.series).toHaveLength(INDEX.series.length + 2);
    expect(v.series.at(-1)![1]).toBe(R.index);
    expect(v.series.at(-2)).toEqual(["2026-10-09T16:00:00Z", R.closedHours[0].index]);
    expect(v.head_block).toBe(R.head);
    expect(v.projects[0].share).toBeGreaterThanOrEqual(v.projects[1].share);
    expect(v.projects.reduce((a, p) => a + p.share, 0)).toBeCloseTo(100, 9);
    const rows = activityRows(v);
    expect(rows[0].open).toBe(true);
    expect(rows.some((r) => !r.open)).toBe(true);
  });
  test("status: live, paused with the last good value, delayed", async () => {
    const R = await live(100);
    const now = Date.parse("2026-10-09T15:30:00Z");
    expect(liveStatus(INDEX, R, 0, true, now)).toMatchObject({ tone: "ok", paused: false });
    expect(liveStatus(INDEX, R, 0, true, now).text).toMatch(/^Live · \d\d:\d\d:\d\d UTC$/);
    expect(liveStatus(INDEX, R, 2, true, now)).toMatchObject({ tone: "neutral", paused: true });
    expect(liveStatus(INDEX, R, 2, true, now).text).toMatch(/^Live update paused · Hour closed 9 Oct 15:00 UTC$/);
    expect(liveStatus(INDEX, R, 0, true, now, true)).toMatchObject({ tone: "down", text: "Data delayed · Hour closed 9 Oct 15:00 UTC" });
    expect(liveStatus(INDEX, null, 0, false, now)).toMatchObject({ paused: false, text: "Hour closed 9 Oct 15:00 UTC" });
    expect(liveStatus(INDEX, null, 0, false, Date.parse("2026-10-09T20:00:00Z")).tone).toBe("down");
  });
});

describe("data only: no trading words anywhere in the page source", () => {
  const root = resolve(__dirname, "../..");
  const files = [
    "src/app/builders-index/page.tsx",
    "src/components/builders-index/IndexPage.tsx",
    "src/lib/builders-index-page.ts",
    "src/lib/builders-index.ts",
    "src/lib/builders-index-fixture.ts",
    "src/lib/abi-live.ts",
    "src/lib/abi-live-mock.ts",
    "builders-site/lib/builders-index.ts",
    ...readdirSync(resolve(root, "builders-site/functions/api/index")).map((f) => `builders-site/functions/api/index/${f}`),
  ];
  const WORDS = /\b(trade|trades|trading|trader|traders|long|short|leverage|leveraged|perp|perps|perpetual|perpetuals|buy|buys|sell|sells|bet|bets|betting|wager|wagers|odds|position|positions|swap|swaps|futures)\b/i;
  test.each(files)("%s", (f) => {
    expect(readFileSync(resolve(root, f), "utf8").match(WORDS)?.[0]).toBeUndefined();
  });
  test("the page does not use the wallet shell", () => {
    expect(readFileSync(resolve(root, "src/app/builders-index/page.tsx"), "utf8")).not.toMatch(/wallet/i);
  });
  const built = resolve(root, "dist-builders/builders-index/index.html");
  test.skipIf(!existsSync(built))("the built page (skipped: run the builders-site build to create dist-builders)", () => {
    const text = readFileSync(built, "utf8").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    expect(text.match(WORDS)?.[0]).toBeUndefined();
  });
});
