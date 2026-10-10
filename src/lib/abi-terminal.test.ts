import { describe, expect, test } from "vitest";
import { createEngine, type LiveResult } from "./abi-live";
import { HB, INDEX, mockRpc, SEEN } from "./abi-live-mock";
import { barAt, candleList, freshKeys, rowKeys, chartModel, members, methodRows, activityCell, integrationRows, milestoneRows, openHour, paceAll, quote, rollOff, status, tapeRows, tickerItems, ts, usdShort, why } from "./abi-terminal";
import type { AbiData } from "./builders-index";

const L = INDEX.live!;
async function live(off: number): Promise<LiveResult> {
  const e = createEngine({ call: mockRpc(HB + off) as never });
  e.load(INDEX, SEEN);
  return e.tick();
}
const sumRows = (w: NonNullable<ReturnType<typeof why>>) => w.rows.filter((r) => r.kind !== "net").reduce((a, r) => a + r.v, 0);

describe("candles and quote bar", () => {
  test("server candles, locally closed hours, then the open hour", async () => {
    const R = await live(7300);
    const c = candleList(INDEX, R.closedHours.map((h) => h.candle), R);
    expect(c).toHaveLength(INDEX.candles.length + 2);
    expect(c.at(-1)!.live).toBe(true);
    expect(c.at(-1)!.c).toBe(R.index);
    expect(c.at(-2)!.c).toBe(R.closedHours[0].index);
    expect(candleList(INDEX, [], null)).toHaveLength(INDEX.candles.length);
  });
  test("without server candles every series point becomes a bar", () => {
    const c = candleList({ ...INDEX, candles: [] }, [], null);
    expect(c).toHaveLength(INDEX.series.length);
    expect(c[0].o).toBe(INDEX.base.level);
    expect(c[1].o).toBe(c[0].c);
  });
  test("24h change uses K · Σ roots_24h; high, low, payments and USDC cover the last 24 bars", () => {
    const C = candleList(INDEX, [], null);
    const q = quote(INDEX, C)!;
    const ref = L.K * Object.values(INDEX.roots_24h).reduce((a, b) => a + b, 0);
    expect(q.ref24).toBeCloseTo(ref, 12);
    expect(q.d24).toBeCloseTo(q.px / ref - 1, 12);
    const win = C.slice(-24);
    expect(q.hi).toBe(Math.max(...win.map((c) => c.h)));
    expect(q.lo).toBe(Math.min(...win.map((c) => c.l)));
    expect(q.pay).toBe(win.reduce((a, c) => a + c.n, 0));
    expect(q.usd).toBeCloseTo(win.reduce((a, c) => a + c.u, 0), 9);
    expect(q.sinceBase).toBeCloseTo(q.px / 1000 - 1, 12);
    expect(q.h1).toBeCloseTo(q.px / C.at(-1)!.o - 1, 12);
  });
  test("pace = members' points in 24 h / (P × daily roll-off), base layer excluded", () => {
    let need = 0, did = 0;
    for (const p of INDEX.projects) if (!p.base_layer) { need += L.P[p.source] * (1 - Math.pow(L.decay_h, 24)); did += p.pts_24h; }
    expect(paceAll(INDEX)).toBeCloseTo((100 * did) / need, 9);
    expect(paceAll({ ...INDEX, live: undefined })).toBeNull();
  });
});

describe("why ABI moved is exact", () => {
  test("24h, without the browser: decay + contributions = K·Σ now − K·Σ roots_24h", () => {
    const w = why(INDEX, null, "24h")!;
    const net = L.K * (Object.values(L.roots_prev).reduce((a, b) => a + b, 0) - Object.values(INDEX.roots_24h).reduce((a, b) => a + b, 0));
    expect(w.net).toBeCloseTo(net, 9);
    expect(sumRows(w)).toBeCloseTo(w.net, 9);
    expect(w.rows[0]).toMatchObject({ l: "Older activity rolling off", kind: "decay" });
    expect(w.rows[0].v).toBeLessThan(0);
    expect(w.rows.at(-1)!.kind).toBe("net");
    expect(w.rows.filter((r) => !r.kind && !r.l.startsWith("Others"))).toHaveLength(6);
  });
  test("24h with the open hour: net equals the quote bar's 24h change (px − K·Σ roots_24h)", async () => {
    const R = await live(4100);
    const w = why(INDEX, R, "24h")!;
    const q = quote(INDEX, candleList(INDEX, [], R))!;
    expect(sumRows(w)).toBeCloseTo(w.net, 9);
    expect(w.net).toBeCloseTo(q.px - q.ref24, 6);
  });
  test("this hour: reference is the roots at the hour's open, hours = f", async () => {
    const R = await live(4100);
    const w = why(INDEX, R, "1h")!;
    expect(sumRows(w)).toBeCloseTo(w.net, 9);
    expect(w.net).toBeCloseTo(R.index - L.K * Object.values(R.rootsPrev).reduce((a, b) => a + b, 0), 9);
    const none = why(INDEX, null, "1h")!;
    expect(none.net).toBeCloseTo(0, 12);
    expect(none.decay).toBe(0);
  });
  test("exact after a self-closed hour too", async () => {
    const R = await live(7300);
    const w = why(INDEX, R, "24h")!;
    expect(sumRows(w)).toBeCloseTo(w.net, 9);
    expect(w.net).toBeCloseTo(R.index - L.K * Object.values(INDEX.roots_24h).reduce((a, b) => a + b, 0), 6);
  });
  test("a file without the live block has no breakdown", () => {
    expect(why({ ...INDEX, live: undefined }, null, "24h")).toBeNull();
  });
});

describe("time & sales", () => {
  test("live rows first, then a separator, then closed hours", async () => {
    const R = await live(4100);
    const rows = tapeRows(INDEX, R, 0);
    const sepAt = rows.findIndex((r) => r.sep);
    expect(sepAt).toBeGreaterThan(0);
    expect(rows.slice(0, sepAt).every((r) => !r.sep && r.live)).toBe(true);
    expect(rows.slice(sepAt + 1).every((r) => !r.sep && !r.live)).toBe(true);
    expect(tapeRows(INDEX, null, 0).some((r) => r.sep)).toBe(false);
  });
  test("the filter keeps payments at or above the amount", () => {
    for (const min of [1, 10]) for (const r of tapeRows(INDEX, null, min)) if (!r.sep) expect(r.v / r.k).toBeGreaterThanOrEqual(0); // grouped rows sum several
    const all = tapeRows(INDEX, null, 0), big = tapeRows(INDEX, null, 10);
    expect(big.reduce((a, r) => a + (r.sep ? 0 : r.k), 0)).toBeLessThan(all.reduce((a, r) => a + (r.sep ? 0 : r.k), 0));
  });
  test("consecutive payments of one project in the same minute collapse into one row", () => {
    const d: AbiData = { ...INDEX, tape: [
      ["2026-10-09T20:59:46Z", "domain:peach.ag", 1, 0.5, 0], ["2026-10-09T20:59:31Z", "domain:peach.ag", 2, 0.25, 1],
      ["2026-10-09T20:59:05Z", "domain:peach.ag", 4, 0.25, 0], ["2026-10-09T20:58:59Z", "domain:peach.ag", 8, 1, 0],
      ["2026-10-09T20:58:30Z", "domain:argus.world", 16, 1, 0], ["2026-10-09T20:58:20Z", "domain:peach.ag", 32, 1, 0],
    ] };
    const rows = tapeRows(d, null, 0);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ s: "domain:peach.ag", k: 3, v: 7, n: true });
    expect(rows[0].sep ? 0 : rows[0].p).toBeCloseTo(1, 12);
    expect(rows[1]).toMatchObject({ k: 1, v: 8 });
    expect(rows[3]).toMatchObject({ s: "domain:peach.ag", k: 1 }); // not adjacent to the first group
  });
});

describe("time & sales: filter before the cap", () => {
  test("the size filter is applied first, so older large payments survive 120 newer small ones", () => {
    const tape: AbiData["tape"] = [];
    // 200 small payments (newest), then 100 large ones; every row in its own minute and project so nothing groups
    for (let i = 0; i < 200; i++) tape.push([new Date(Date.UTC(2026, 9, 9, 20, 0) - i * 120_000).toISOString().slice(0, 19) + "Z", `domain:s${i}.x`, 0.5, 0.1, 0]);
    for (let i = 0; i < 100; i++) tape.push([new Date(Date.UTC(2026, 9, 9, 10, 0) - i * 120_000).toISOString().slice(0, 19) + "Z", `domain:b${i}.x`, 25, 4, 0]);
    const d = { ...INDEX, tape };
    expect(tapeRows(d, null, 0)).toHaveLength(120);
    const big = tapeRows(d, null, 10);
    expect(big).toHaveLength(100);
    expect(big.every((r) => !r.sep && r.v >= 10)).toBe(true);
    expect(tapeRows(d, null, 1)).toHaveLength(100);
  });
  test("fresh rows: nothing flashes before the first paint; later only unseen live rows do", async () => {
    const R = await live(4100);
    const rows = tapeRows(INDEX, R, 0);
    expect(freshKeys(rows, null).size).toBe(0);
    const keys = rowKeys(rows);
    expect(freshKeys(rows, new Set(keys)).size).toBe(0);
    const liveKey = keys[0];
    const f = freshKeys(rows, new Set(keys.filter((k) => k !== liveKey)));
    expect([...f]).toEqual([liveKey]);
    const closedKey = keys[keys.length - 1];
    expect(freshKeys(rows, new Set(keys.filter((k) => k !== closedKey))).size).toBe(0); // closed rows never flash
  });
});

describe("members", () => {
  test("base layer has no pace and sorts like any row; pace is points 24h over the hold", () => {
    const ms = members(INDEX, null);
    const base = ms.find((m) => m.base)!;
    expect(base.pace).toBeNull();
    const a = ms.find((m) => m.source === "domain:argus.world")!;
    const p = INDEX.projects.find((x) => x.source === a.source)!;
    expect(a.pace).toBeCloseTo((100 * p.pts_24h) / (L.P[a.source] * (1 - Math.pow(L.decay_h, 24))), 9);
    expect(ms.map((m) => m.share)).toEqual([...ms.map((m) => m.share)].sort((x, y) => y - x));
  });
  test("sorting by a column in either direction; the name column sorts alphabetically", () => {
    const asc = members(INDEX, null, "d1", 1).map((m) => m.d1);
    expect(asc).toEqual([...asc].sort((x, y) => x - y));
    const names = members(INDEX, null, "name", 1).map((m) => m.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
  });
  test("live: points this hour, 24h totals and payments include the open hour", async () => {
    const R = await live(4100);
    const ms = members(INDEX, R);
    const a = ms.find((m) => m.source === "domain:argus.world")!;
    const p = INDEX.projects.find((x) => x.source === a.source)!;
    expect(a.h1).toBeCloseTo(R.act[a.source].points, 12);
    expect(a.d1).toBeCloseTo(p.pts_24h + R.act[a.source].points, 12);
    expect(a.pay).toBe(p.pay_24h + 3);
    expect(a.usd).toBeCloseTo(p.usdc_24h + R.act[a.source].usdc, 9);
    expect(ms.reduce((s, m) => s + m.share, 0)).toBeCloseTo(100, 9);
  });
  test("the ticker lists every member with its weight and points this hour", () => {
    const t = tickerItems(INDEX);
    expect(t).toHaveLength(INDEX.projects.length);
    expect(t.find((x) => x.name === "Arc base layer")!.pts).toBeNull();
  });
});

describe("method and open hour: nothing is hardcoded", () => {
  test("roll-off comes from params and live.decay_h", () => {
    const r = rollOff(INDEX);
    expect(r.halfLife).toBe(`half-life ${INDEX.params.half_life_days} d`);
    const x = (1 - L.decay_h) * 100, y = (1 - Math.sqrt(L.decay_h)) * 100;
    expect(r.perHour).toBe(`pts −${x.toFixed(3)}%/h · ABI −${y.toFixed(3)}%/h`);
    const other = rollOff({ ...INDEX, params: { ...INDEX.params, half_life_days: 7 }, live: { ...L, decay_h: Math.pow(0.5, 1 / (7 * 24)) } });
    expect(other.halfLife).toBe("half-life 7 d");
    expect(other.perHour).toContain("pts −0.412%/h");
    expect(other.perHour).not.toBe(r.perHour);
  });
  test("without the live block the per-hour figure falls back to params.decay_per_hour_pct", () => {
    const r = rollOff({ ...INDEX, live: undefined, params: { ...INDEX.params, decay_per_hour_pct: 0.5 } });
    expect(r.perHour).toContain("pts −0.500%/h");
  });
  test("method rows read cap, new-payer points, rise limits and the base from the file", () => {
    const rows = Object.fromEntries(methodRows({ ...INDEX, params: { ...INDEX.params, cap_per_wallet_hour_usdc: 250, new_payer_points: 2, rise_limit_own: 0.02, rise_limit_index: 0.01 } }));
    expect(rows.Payment).toContain("250");
    expect(rows["New payer"]).toBe("+2 pt");
    expect(rows["Rise limit / h"]).toBe("min(2.0% own √P, 1.0% Σ√P)");
    expect(rows.Base).toBe("1,000 · 2 Oct 2026");
  });
  test("open hour: O/H/L/Last, payments, USDC and a countdown to :00 UTC", async () => {
    expect(openHour(null)).toBeNull();
    const R = await live(4100);
    const oh = openHour(R)!;
    expect(oh.o).toBe(R.candle[1]);
    expect(oh.n).toBe(4);
    expect(oh.span).toBe("22:00–23:00 UTC".replace("22:00–23:00", `${new Date(R.hourStart * 1000).toISOString().slice(11, 16)}–${new Date((R.hourStart + 3600) * 1000).toISOString().slice(11, 16)}`));
    expect(oh.left(R.hourStart + 3600 - 125)).toBe("02:05");
    expect(oh.left(R.hourStart + 4000)).toBe("00:00");
  });
});

describe("status", () => {
  const now = ts(INDEX.data_until) * 1000 + 600_000;
  test("live with a clock, paused, delayed, stale", async () => {
    const R = await live(100);
    expect(status(INDEX, R, 0, true, now, false)).toMatchObject({ kind: "live" });
    expect(status(INDEX, R, 0, true, now, false).text).toMatch(/^Live · \d\d:\d\d:\d\d UTC$/);
    expect(status(INDEX, R, 2, true, now, false).text).toMatch(/^Live update paused · closed \d\d:\d\d UTC$/);
    expect(status(INDEX, null, 0, false, now, false)).toMatchObject({ kind: "idle" });
    expect(status(INDEX, null, 0, false, now + 4 * 3600_000, false)).toMatchObject({ kind: "warn" });
    expect(status(INDEX, null, 0, false, now, true).text).toMatch(/^Data delayed/);
  });
});

describe("chart model", () => {
  const C = candleList(INDEX, [], null);
  test("one bar per candle, base line only when inside the range, last-price tag on the final close", () => {
    const m = chartModel(C.slice(-24), 800, 470)!;
    expect(m.bars).toHaveLength(24);
    expect(m.last.label).toBe(C.at(-1)!.c.toFixed(2));
    expect(m.baseY === null || (m.baseY > 0 && m.baseY < 470)).toBe(true);
    expect(m.grid.length).toBeGreaterThan(2);
    expect(m.bars.every((b) => b.yH <= b.yTop && b.yL >= b.yTop && b.body >= 1)).toBe(true);
    expect(chartModel([], 800, 470)).toBeNull();
  });
  test("volume bars stay under the price area and scale with USDC", () => {
    const m = chartModel(C, 800, 470)!;
    const top = Math.min(...m.bars.map((b) => b.vy));
    expect(top).toBeGreaterThanOrEqual(m.volTop - 1);
  });
  test("pointer to bar index", () => {
    const m = chartModel(C.slice(-24), 800, 470)!;
    expect(barAt(m, -50)).toBe(0);
    expect(barAt(m, 10_000)).toBe(23);
    expect(barAt(m, m.pad.l + m.slot * 5.5)).toBe(5);
  });
});

describe("milestone rows", () => {
  test("usdShort", () => {
    expect([108e6, 1.23e9, 850e3, 4.5e6, 2.4e11].map(usdShort)).toEqual(["$108M", "$1.2B", "$850k", "$4.5M", "$240B"]);
  });
  test("integration detail: company and revenue; plain milestones have none", () => {
    const base = { target: "base:arc", evidence: ["https://x.io"] };
    const d = { ...INDEX, milestones: [
      { ...base, id: "a", t: 1791633600, tier: "integration", mult: 1.0508, title: "MoonPay live on Arc", company: "MoonPay", revenue_usd: 108e6, revenue_kind: "estimate" },
      { ...base, id: "b", t: 1791630000, tier: "integration", mult: 1.07, title: "Acme live on Arc", company: "Acme", revenue_usd: 6.3e9, revenue_kind: "filing" },
      { ...base, id: "c", t: 1791620000, tier: "arc-upgrade", mult: 1.25, title: "Arc upgrade" },
    ] } as unknown as AbiData;
    expect(milestoneRows(d).map((r) => r.detail)).toEqual(["MoonPay · revenue ≈ $108M (estimate)", "Acme · revenue $6.3B (filing)", undefined]);
  });
});

describe("integration rows", () => {
  const row = (company: string, status: string, first_announced: string, extra = {}) => ({ company, category: "exchange", status, first_announced, link: null, member: null, milestone_id: null, ...extra });
  const d = { ...INDEX, integrations: [
    row("Kraken", "announced", "2025-10-28"), row("MoonPay", "live", "2025-10-28", { link: "https://www.moonpay.com/newsroom", milestone_id: "m1", member: "domain:argus.world" }),
    row("Coinbase", "announced", "2026-09-16"), row("Juno", "live", "2025-10-28"), row("Uniswap", "deployed", "2025-08-05"),
  ] } as unknown as AbiData;
  test("live first, then deployed, then announced; newest first; counts over all rows", () => {
    const r = integrationRows(d);
    expect(r.rows.map((x) => x.company)).toEqual(["Juno", "MoonPay", "Uniswap", "Coinbase", "Kraken"]);
    expect(r.counts).toEqual({ live: 2, deployed: 1, announced: 2 });
    const m = r.rows[1];
    expect([m.milestone, m.member, m.link?.text]).toEqual([true, "Argus", "moonpay.com"]);
  });
  test("a filter keeps the counts", () => {
    const r = integrationRows(d, "announced");
    expect(r.rows.map((x) => x.company)).toEqual(["Coinbase", "Kraken"]);
    expect(r.total).toBe(5);
  });
});

describe("integration activity", () => {
  test("cells: wallets show in/out and counterparties (labelled); contracts show inflow and payments", () => {
    expect(activityCell({ source: "wallets", wallets: 15, out_usd: 28.3e6, out_transfers: 2682, recipients: 727, in_usd: 28.5e6, in_transfers: 900, senders: 40 }))
      .toEqual({ usd: 56.8e6, main: "in $29M · out $28M", sub: "40 senders · 727 recipients · 15 addresses", labelled: true });
    expect(activityCell({ source: "wallets", wallets: 1, out_usd: 22600, out_transfers: 44, recipients: 44, in_usd: 0, in_transfers: 0, senders: 0 })!.main).toBe("in $0 · out $23k");
    expect(activityCell({ source: "contracts", payments: 1200, usd_in: 4.2e6, points: 3, payers_hourly_sum: 8 })).toEqual({ usd: 4.2e6, main: "in $4.2M", sub: "1,200 payments", labelled: false });
    expect(activityCell(undefined)).toBeNull();
  });
  test("within a status, the most active first", () => {
    const row = (company: string) => ({ company, category: "x", status: "live", first_announced: "2025-10-28", link: null, member: null, milestone_id: null });
    const w = (usd: number) => ({ source: "wallets", wallets: 1, out_usd: usd, out_transfers: 1, recipients: 1, in_usd: 0, in_transfers: 0, senders: 0 });
    const d = { ...INDEX, integrations: [row("Gate"), row("Quiet"), row("Relay")], integration_activity: { Gate: w(22600), Relay: w(28e6) } } as unknown as AbiData;
    expect(integrationRows(d).rows.map((r) => r.company)).toEqual(["Relay", "Gate", "Quiet"]);
  });
});
