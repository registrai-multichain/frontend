import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, test } from "vitest";
import * as Engine from "../../src/lib/abi-pilot";
import type { EconomyView } from "../../src/lib/abi-pilot-api";
import { handleEconomy, handleFunding, handleLeaderboard, handlePositions, handlePublicMark, loadRates, MAX_BATCH_STATEMENTS, TOO_MANY_PENDING, weekStart } from "../lib/pilot";
import { MIGRATIONS } from "../lib/pilot-sql";
import { MemoryD1 } from "./memory-d1";
import { ALICE, BOB, lc, ONE, setup, SNAP, type Json } from "./pilot-harness";

/**
 * Three markets (plan docs/superpowers/plans/2026-10-12-pilot-three-markets.md R1–R7, spec §9.16): ABI, AII and AEI
 * share one balance per wallet; everything else (mark, bars, rates, house, pools, split) is per market.
 */
type Market = "abi" | "aii" | "aei";
const MARKETS: Market[] = ["abi", "aii", "aei"];
// Anvil's dev key: never real funds.
const CAROL = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

function three() {
  const t = setup();
  t.balances.set(`${lc(CAROL)}@latest`, ONE);
  t.balances.set(`${lc(CAROL)}@0x${SNAP.toString(16)}`, ONE);
  const sizes: number[] = [];
  const realBatch = t.db.batch.bind(t.db);
  t.db.batch = (async (stmts: Parameters<typeof realBatch>[0]) => { sizes.push(stmts.length); return realBatch(stmts); }) as typeof t.db.batch;
  const one = <T,>(sql: string, ...p: unknown[]) => t.db.q<T>(sql, ...p)[0];
  const hour = () => Math.floor(t.nowS() / 3600) * 3600;
  const minute = () => Math.floor(t.nowS() / 60) * 60;
  const nextHour = (min = 0, sec = 5) => t.tick((hour() + 3600 + min * 60 + sec - t.nowS()) * 1000);
  /** A post in `m` (the ABI one without "index", as today's producer sends it). */
  const post = (m: Market, px = 1000, x: Json = {}) => t.markJson(px, { ...(m === "abi" ? {} : { index: m }), ...x });
  /** A post in every market at the same clock. */
  const postAll = async (px = 1000, x: Json = {}) => { for (const m of MARKETS) expect((await post(m, px, x)).status).toBe(200); };
  /** Submit in `m`, then the next mark of `m` (1 s later) fills it. */
  const openIn = async (m: Market, cookie: string, side: "long" | "short", margin: number, lev: number, px = 1000) => {
    const s = await t.submit(cookie, { market: m, side, margin, lev });
    expect(s.status, JSON.stringify(s.body)).toBe(202);
    expect(s.body.order.market).toBe(m);
    t.tick(1000);
    expect((await post(m, px)).status).toBe(200);
    const st = await t.status(cookie, s.body.order.id);
    expect(st.body.order.status, JSON.stringify(st.body)).toBe("filled");
    return st.body as Json;
  };
  const closeIn = async (m: Market, cookie: string, id: number, px = 1000) => {
    const s = await t.submitClose(cookie, id);
    expect(s.status, JSON.stringify(s.body)).toBe(202);
    expect(s.body.order.market).toBe(m);
    t.tick(1000);
    expect((await post(m, px)).status).toBe(200);
    return (await t.status(cookie, s.body.order.id)).body as Json;
  };
  const traders = () => one<{ d: number }>("SELECT COALESCE(SUM(balance - 10000), 0) AS d FROM accounts").d;
  const ledger = (m?: Market) => one<{ s: number }>(`SELECT COALESCE(SUM(amount), 0) AS s FROM ledger${m ? " WHERE market = ?" : ""}`, ...(m ? [m] : [])).s;
  const pools = (m: Market) => one<{ s: number }>("SELECT SUM(balance) AS s FROM pools WHERE market = ?", m).s;
  const insurance = (m: Market) => one<{ s: number }>("SELECT SUM(balance) AS s FROM pools WHERE market = ? AND kind IN ('split_insurance', 'insurance_draw')", m).s;
  /**
   * Conservation over every market (as pilot-v3.test.ts, summed): Σ balance changes + Σ ledger + open margin − the
   * house's and the cut's claims booked on open positions − the projected cut of fixed hours not yet booked = 0; each
   * market's pools equal its ledger and its insurance is never negative.
   */
  const conserved = (strict = false) => {
    const open = one<{ m: number; b: number }>("SELECT COALESCE(SUM(margin), 0) AS m, COALESCE(SUM(booked + booked_cut), 0) AS b FROM positions WHERE closed_at IS NULL");
    const pending = one<{ s: number }>("SELECT COALESCE(SUM(cut), 0) AS s FROM rates r WHERE NOT EXISTS (SELECT 1 FROM house_hours h WHERE h.market = r.market AND h.hour = r.hour)").s;
    expect(traders() + ledger() + open.m - open.b - pending).toBeCloseTo(0, 6);
    for (const m of MARKETS) {
      expect(pools(m)).toBeCloseTo(ledger(m), 6);
      expect(insurance(m)).toBeGreaterThanOrEqual(0);
    }
    if (strict) {
      expect(open.m).toBe(0);
      expect(traders() + ledger()).toBeCloseTo(0, 6);
    }
  };
  /** Posts every market every hour (with a trend) until each market's house has booked the hour before the current one. */
  const bookAll = async (px = 1000) => {
    for (let i = 0; i < 12; i++) {
      const behind = MARKETS.filter((m) => {
        const booked = one<{ h: number | null }>("SELECT MAX(hour) AS h FROM house_hours WHERE market = ?", m).h;
        const late = t.db.q("SELECT id FROM positions WHERE market = ? AND closed_at IS NULL AND booked_to < ?", m, hour()).length;
        const open = t.db.q("SELECT id FROM positions WHERE market = ? AND closed_at IS NULL", m).length;
        const pending = one<{ s: number }>("SELECT COALESCE(SUM(ABS(cut)), 0) AS s FROM rates WHERE market = ? AND hour NOT IN (SELECT hour FROM house_hours WHERE market = ?) AND hour < ?", m, m, open ? hour() : hour() + 3600).s;
        return !(booked === hour() - 3600 && !late && pending === 0);
      });
      if (!behind.length) return;
      nextHour(0, 20);
      await postAll(px, { trend: 0 });
    }
    throw new Error("the houses never caught up");
  };
  const economy = async (m: Market) => (await (await handleEconomy(t.req(`/api/pilot/economy?market=${m}`), t.env, t.deps)).json()) as EconomyView;
  return { ...t, sizes, one, hour, minute, nextHour, post, postAll, openIn, closeIn, traders, ledger, pools, insurance, conserved, bookAll, economy };
}

describe("mark ingest per market (R4)", () => {
  test("a post without index lands in ABI; index aii / aei land in their own row; anything else is refused", async () => {
    const t = three();
    const r = await t.markJson(1000, { trend: 0.0001 }); // today's producer: no "index"
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ index: "abi", fixed: true });
    expect(t.db.q("SELECT market, px FROM mark")).toEqual([{ market: "abi", px: 1000 }]);
    expect(t.db.q("SELECT DISTINCT market FROM bars")).toEqual([{ market: "abi" }]);
    expect((await t.post("aii", 2000)).body).toMatchObject({ index: "aii", fixed: true });
    expect((await t.post("aei", 3000)).body).toMatchObject({ index: "aei" });
    expect(t.db.q("SELECT market, px FROM mark ORDER BY market")).toEqual([{ market: "abi", px: 1000 }, { market: "aei", px: 3000 }, { market: "aii", px: 2000 }]);
    for (const bad of ["ABI", "xyz", 1]) {
      const b = await t.markJson(1000, { index: bad as string });
      expect(b.status).toBe(400);
      expect(b.body.error).toMatch(/index/);
    }
    // the public mark per index (default abi); a wrong one is 400
    const pub = async (q: string) => { const res = await handlePublicMark(t.req(`/api/index/mark${q}`), t.env, t.deps); return { status: res.status, body: (await res.json()) as Json }; };
    expect((await pub("")).body.mark).toBe(1000);
    expect((await pub("?index=aii")).body.mark).toBe(2000);
    expect((await pub("?index=aei")).body.mark).toBe(3000);
    expect((await pub("?index=nope")).status).toBe(400);
    // the same timestamp in another market is not "older": each market moves forward on its own
    const ts = t.nowS();
    t.tick(1000);
    expect((await t.post("aii", 2001, { ts: ts + 1 })).status).toBe(200);
    expect((await t.post("aei", 3001, { ts: ts + 1 })).status).toBe(200);
    expect((await t.post("aii", 2001, { ts: ts + 1 })).status).toBe(409);
  });

  test("each market fixes its own hour's rates once (twice per hour per market → once); a post never fixes another market's", async () => {
    const t = three();
    const H = t.hour();
    expect((await t.post("abi", 1000, { trend: -0.0002 })).body.fixed).toBe(true);
    t.tick(5000);
    expect((await t.post("aii", 1000, { trend: null })).body.fixed).toBe(false);
    expect(t.db.q("SELECT market, hour, trend FROM rates ORDER BY market")).toEqual([{ market: "abi", hour: H, trend: -0.0002 }]);
    t.tick(5000);
    expect((await t.post("aii", 1000, { trend: 0.0003 })).body.fixed).toBe(true);
    t.tick(5000);
    expect((await t.post("aii", 1000, { trend: 0.0009 })).body.fixed).toBe(false);
    expect((await t.post("abi", 1000, { trend: 0.0009 })).body.fixed).toBe(false);
    expect(t.db.q("SELECT market, hour, trend FROM rates ORDER BY market")).toEqual([{ market: "abi", hour: H, trend: -0.0002 }, { market: "aii", hour: H, trend: 0.0003 }]);
    // the projected cut and the booked hour are per market too
    expect(t.db.q("SELECT market, hour FROM house_hours ORDER BY market")).toEqual([{ market: "abi", hour: H - 3600 }, { market: "aii", hour: H - 3600 }]);
    expect(t.db.q("SELECT market, funding_known, funding_rate FROM mark ORDER BY market")).toEqual([{ market: "abi", funding_known: 1, funding_rate: -0.0002 }, { market: "aii", funding_known: 1, funding_rate: 0.0003 }]);
    // the funding and economy reads are per market (?market=, default abi); a wrong one is 400
    const f = async (q: string) => { const res = await handleFunding(t.req(`/api/pilot/funding${q}`), t.env, t.deps); return { status: res.status, body: (await res.json()) as Json }; };
    expect((await f("")).body).toMatchObject({ market: "abi", current: { trend: -0.0002 } });
    expect((await f("?market=aii")).body).toMatchObject({ market: "aii", current: { trend: 0.0003 } });
    expect((await f("?market=aei")).body).toMatchObject({ market: "aei", current: null, recent: [] });
    expect((await f("?market=x")).status).toBe(400);
    expect((await t.economy("aii")).market).toBe("aii");
    expect((await handleEconomy(t.req("/api/pilot/economy?market=x"), t.env, t.deps)).status).toBe(400);
  });

  test("AII has no base layer: a base sample never pauses AII; ABI and AEI pause", async () => {
    const t = three();
    const alice = await t.signIn();
    await t.post("aii", 1000, { trend: 0, base_pending: true });
    await t.post("abi", 1000, { trend: 0, base_pending: true });
    expect(t.db.q("SELECT market, base_pending FROM mark ORDER BY market")).toEqual([{ market: "abi", base_pending: 1 }, { market: "aii", base_pending: 0 }]);
    expect((await t.account(alice, "aii")).body.mark.basePaused).toBe(false);
    expect((await t.account(alice, "abi")).body.mark.basePaused).toBe(true);
    expect((await t.submit(alice, { market: "abi", side: "long", margin: 100, lev: 2 })).body.error).toBe("trading paused");
    const s = await t.submit(alice, { market: "aii", side: "long", margin: 100, lev: 2 });
    expect(s.status).toBe(202);
    t.tick(1000);
    await t.post("aii", 1000, { base_pending: true, base_step_ts: t.nowS() - 5 });
    expect((await t.status(alice, s.body.order.id)).body.order.status).toBe("filled");
  });

  test("R7: gap bars read the market's own index file", async () => {
    const t = three();
    await t.postAll(1000, { trend: 0 });
    const H = t.hour();
    // AEI's file says hour H dipped to 950; ABI's stays flat
    await t.setCandles(Array.from({ length: 72 }, (_, i) => { const h = H - 24 * 3600 + i * 3600; return [h, 1000, h === H ? 950 : 1000, 1000]; }), "aei");
    t.nextHour(20); // both producers down from H:00 to H+1:20
    expect((await t.post("abi", 1000, { trend: 0 })).body.gapBars).toBeGreaterThan(0);
    expect((await t.post("aei", 1000, { trend: 0 })).body.gapBars).toBeGreaterThan(0);
    expect(t.db.q("SELECT market, l FROM bars WHERE minute = ? ORDER BY market", H + 3540)).toEqual([{ market: "abi", l: 1000 }, { market: "aei", l: 950 }]);
  });
});

describe("one balance, rules per market (R2, R3)", () => {
  test("one direction per market: long ABI + short AII is allowed, long + short ABI is refused; the balance is shared", async () => {
    const t = three();
    const alice = await t.signIn();
    await t.postAll(1000, { trend: 0 });
    await t.openIn("abi", alice, "long", 1000, 5);
    await t.openIn("aii", alice, "short", 1000, 5);
    const refused = await t.submit(alice, { market: "abi", side: "short", margin: 100, lev: 2 });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("Close your long first");
    // one balance: both opens came out of it
    expect(t.balanceOf(lc(ALICE))).toBeCloseTo(10000 - 2 * (1000 + 5000 * Engine.RULES.feeRate), 9);
    expect(t.db.q("SELECT market, side FROM positions ORDER BY id")).toEqual([{ market: "abi", side: "long" }, { market: "aii", side: "short" }]);
    // more longs in ABI and a short in AEI fill; the fill re-checks the direction per market
    await t.openIn("aei", alice, "short", 100, 2);
    await t.openIn("abi", alice, "long", 100, 2);
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions WHERE market = 'abi' AND side = 'long'")).toEqual([{ n: 2 }]);
    // RULES.maxOpen is per market: 5 in ABI, and AII still takes more
    for (let i = 0; i < Engine.RULES.maxOpen - 2; i++) await t.openIn("abi", alice, "long", 10, 1);
    expect((await t.submit(alice, { market: "abi", side: "long", margin: 10, lev: 1 })).body.error).toBe("too many open positions");
    await t.openIn("aii", alice, "short", 10, 1);
    // the ledger and pools: each open fee in its own market
    expect(t.db.q("SELECT market, COUNT(*) AS n FROM ledger WHERE kind = 'fee' GROUP BY market ORDER BY market")).toEqual([{ market: "abi", n: 5 }, { market: "aei", n: 1 }, { market: "aii", n: 2 }]);
    t.conserved();
  });

  test("the pending-order cap (3) is per wallet across markets; a close's market is its position's", async () => {
    const t = three();
    const alice = await t.signIn();
    await t.postAll(1000, { trend: 0 });
    const p = await t.openIn("aii", alice, "long", 100, 2);
    t.tick(1000);
    await t.postAll(1000);
    expect((await t.submit(alice, { market: "abi", side: "long", margin: 100, lev: 2 })).status).toBe(202);
    expect((await t.submit(alice, { market: "aei", side: "long", margin: 100, lev: 2 })).status).toBe(202);
    const c = await t.submitClose(alice, p.order.positionId);
    expect(c.status).toBe(202);
    expect(c.body.order.market).toBe("aii");
    const fourth = await t.submit(alice, { market: "aii", side: "long", margin: 100, lev: 2 });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error).toBe(TOO_MANY_PENDING);
    expect((await t.submitClose(alice, p.order.positionId)).body.error).toBe(TOO_MANY_PENDING);
    // an ABI post fills only ABI's order; the AII close and the AEI open wait for their own markets
    t.tick(1000);
    await t.post("abi");
    expect(t.db.q("SELECT market, kind, status FROM orders ORDER BY id")).toEqual([
      { market: "aii", kind: "open", status: "filled" }, { market: "abi", kind: "open", status: "filled" }, { market: "aei", kind: "open", status: "pending" }, { market: "aii", kind: "close", status: "pending" },
    ]);
    await t.post("aii");
    await t.post("aei");
    expect(t.db.q("SELECT status FROM orders")).toEqual([{ status: "filled" }, { status: "filled" }, { status: "filled" }, { status: "filled" }]);
    expect(t.db.q("SELECT market, reason FROM positions ORDER BY id")).toEqual([{ market: "aii", reason: "close" }, { market: "abi", reason: null }, { market: "aei", reason: null }]);
    t.conserved();
  });

  test("an order in a market without a live mark is refused (price updating); the other markets trade", async () => {
    const t = three();
    const alice = await t.signIn();
    await t.post("abi", 1000, { trend: 0 });
    const r = await t.submit(alice, { market: "aei", side: "long", margin: 100, lev: 2 });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("price updating");
    expect((await t.submit(alice, { market: "nope", side: "long", margin: 100, lev: 2 })).status).toBe(400);
    expect((await t.submit(alice, { side: "long", margin: 100, lev: 2 })).body.order.market).toBe("abi"); // absent: abi
  });
});

describe("liquidation per market (R4)", () => {
  test("a liquidation in AII leaves ABI's positions, mark, bars and books untouched", async () => {
    const t = three();
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.postAll(1000, { trend: 0 });
    const a = await t.openIn("abi", alice, "long", 1000, 20);
    const b = await t.openIn("aii", bob, "long", 1000, 20);
    const liq = b.position.liq as number;
    expect(a.position.liq).toBeCloseTo(liq, 9); // the same terms in both markets
    t.tick(60_000);
    await t.post("abi");
    const snap = () => ({
      mark: t.db.q("SELECT * FROM mark WHERE market = 'abi'"),
      bars: t.db.q("SELECT * FROM bars WHERE market = 'abi' ORDER BY minute"),
      pools: t.db.q("SELECT kind, balance, gross FROM pools WHERE market = 'abi' ORDER BY kind"),
      ledger: t.db.q("SELECT * FROM ledger WHERE market = 'abi' ORDER BY id"),
      rates: t.db.q("SELECT * FROM rates WHERE market = 'abi'"),
      pos: t.db.q("SELECT * FROM positions WHERE market = 'abi'"),
    });
    const before = snap();
    // AII's finished minute crosses the liquidation price (it would cross ABI's position just the same)
    const m = t.minute();
    t.tick((m + 61 - t.nowS()) * 1000);
    const r = await t.post("aii", 1000, { bars: [[m, 1000, liq - 5, 1000], [m + 60, 1000, 1000, 1000]] });
    expect(r.status).toBe(200);
    expect(r.body.liquidated).toBe(1);
    expect(t.db.q("SELECT market, reason FROM positions ORDER BY id")).toEqual([{ market: "abi", reason: null }, { market: "aii", reason: "liquidation" }]);
    expect(snap()).toEqual(before);
    // the liquidation's rows are AII's
    expect(t.db.q("SELECT DISTINCT market FROM ledger WHERE ref LIKE ?", `%:${b.order.positionId}`)).toEqual([{ market: "aii" }]);
    // ABI's account read and lazy sweep don't touch it either; Alice still holds her long
    expect((await t.account(alice)).body.positions).toHaveLength(1);
    // and an ABI post with the same crossing bar liquidates ABI's position only
    t.tick(1000);
    const r2 = await t.post("abi", 1000, { bars: [[m, 1000, liq - 5, 1000], [m + 60, 1000, 1000, 1000]] });
    expect(r2.body.liquidated).toBe(1);
    expect(t.db.q("SELECT market, reason FROM positions ORDER BY id")).toEqual([{ market: "abi", reason: "liquidation" }, { market: "aii", reason: "liquidation" }]);
    t.conserved();
  });
});

describe("reads across markets (R6)", () => {
  test("the account values each position at its own market's mark; mark and funding are the page market's", async () => {
    const t = three();
    const alice = await t.signIn();
    await t.post("abi", 1000, { trend: -0.0001 });
    await t.post("aii", 2000, { trend: 0.0002 });
    await t.post("aei", 500, { trend: 0 });
    await t.openIn("abi", alice, "long", 1000, 5, 1000);
    await t.openIn("aii", alice, "short", 500, 3, 2000);
    t.tick(30 * 60_000);
    await t.post("abi", 1010);
    await t.post("aii", 1980);
    await t.post("aei", 505);
    const now = t.nowS();
    const view = await t.account(alice, "aii");
    expect(view.status).toBe(200);
    expect(view.body.market).toBe("aii");
    expect(view.body.mark.mark).toBe(1980);
    expect(view.body.funding.long).toBeCloseTo(t.one<{ long: number }>("SELECT long FROM rates WHERE market = 'aii'").long, 15);
    const rows = t.db.q<Json>("SELECT id, market, side, margin, lev, notional, entry, liq, opened_at FROM positions ORDER BY id");
    const px: Record<string, number> = { abi: 1010, aii: 1980 };
    let equity = t.balanceOf(lc(ALICE))!;
    for (const [i, r] of rows.entries()) {
      const pos = { side: r.side, margin: r.margin, lev: r.lev, notional: r.notional, entry: r.entry, openedAt: r.opened_at, liq: r.liq };
      const v = view.body.positions[i];
      expect(v).toMatchObject({ id: r.id, market: r.market, mark: px[r.market], pnl: Engine.pnl(pos, px[r.market]) });
      equity += Engine.equity(0, [pos], px[r.market], now, await loadRates(t.db, r.market, r.opened_at));
    }
    expect(view.body.positions[0].pnl).toBeCloseTo(50, 9); // long ABI 5,000 from 1000 to 1010
    expect(view.body.positions[1].pnl).toBeCloseTo(15, 9); // short AII 1,500 from 2000 to 1980
    expect(view.body.account.equity).toBeCloseTo(equity, 9);
    expect((await t.account(alice)).body).toMatchObject({ market: "abi", mark: { mark: 1010 } });
    expect((await t.account(alice, "x")).status).toBe(400);
    // positions and history carry the market
    const pos = await t.call(handlePositions, t.req("/api/pilot/positions?market=aei", "GET", undefined, { cookie: alice }));
    expect(pos.body.positions.map((p: Json) => [p.market, p.mark])).toEqual([["abi", 1010], ["aii", 1980]]);
    expect(pos.body).toMatchObject({ market: "aei", mark: { mark: 505 } });
    await t.closeIn("aii", alice, view.body.positions[1].id, 1980);
    expect((await t.history(alice)).body.history.map((h: Json) => h.market)).toEqual(["aii"]);
  });

  test("the leaderboard is one board: balance + every open position at its market's latest mark", async () => {
    const t = three();
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.post("abi", 1000, { trend: 0 });
    await t.post("aii", 1000, { trend: 0 });
    await t.post("aei", 1000, { trend: 0 });
    await t.openIn("abi", alice, "long", 1000, 3);
    await t.openIn("aii", alice, "short", 1000, 3);
    await t.openIn("aei", bob, "long", 1000, 3);
    t.tick(5000);
    await t.post("abi", 1100); // Alice +300 on ABI
    await t.post("aii", 1050); // Alice −150 on AII
    await t.post("aei", 900); // Bob −300 on AEI
    const res = await handleLeaderboard(t.req("/api/pilot/leaderboard"), t.env, t.deps);
    const body = (await res.json()) as Json;
    const now = t.nowS();
    const eq = async (w: string) => {
      let e = t.balanceOf(w)!;
      for (const r of t.db.q<Json>("SELECT market, side, margin, lev, notional, entry, liq, opened_at FROM positions WHERE wallet = ? AND closed_at IS NULL", w)) {
        const pos = { side: r.side, margin: r.margin, lev: r.lev, notional: r.notional, entry: r.entry, openedAt: r.opened_at, liq: r.liq };
        e += Engine.equity(0, [pos], ({ abi: 1100, aii: 1050, aei: 900 } as Record<string, number>)[r.market], now, await loadRates(t.db, r.market, r.opened_at));
      }
      return e;
    };
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0].address).toBe(`${lc(ALICE).slice(0, 6)}…${lc(ALICE).slice(-4)}`);
    expect(body.rows[0].equity).toBeCloseTo(await eq(lc(ALICE)), 6);
    expect(body.rows[1].equity).toBeCloseTo(await eq(lc(BOB)), 6);
    // Alice: +300 on ABI, −150 on AII, less two open fees (and a few seconds of borrow and funding)
    expect(body.rows[0].equity - 10000).toBeCloseTo(300 - 150 - 2 * 3000 * Engine.RULES.feeRate, 0);
  });
});

describe("conservation across markets (R4, R5)", () => {
  test("opens in all three, hourly closes, a gap in one, a weekly split per market: Σ balance changes + Σ ledger = 0", async () => {
    const t = three();
    const sign = async () => ({ alice: await t.signIn(), bob: await t.signIn(BOB), carol: await t.signIn(CAROL) });
    let c = await sign();
    await t.post("abi", 1000, { trend: -0.0002 }); // Saturday 12:00 UTC
    await t.post("aii", 1000, { trend: 0.0001 });
    await t.post("aei", 1000, { trend: 0 });
    const a1 = await t.openIn("abi", c.alice, "long", 1000, 10);
    const a2 = await t.openIn("aii", c.alice, "short", 500, 5);
    const b1 = await t.openIn("aii", c.bob, "long", 800, 10);
    const b2 = await t.openIn("aei", c.bob, "long", 300, 20);
    await t.openIn("aei", c.carol, "short", 1000, 3);
    t.conserved();
    // two hours of hourly closes, different trends and prices per market
    for (let h = 0; h < 2; h++) {
      t.nextHour(5);
      await t.post("abi", 1002 + h, { trend: -0.0001 });
      await t.post("aii", 998 - h, { trend: 0.0002 });
      await t.post("aei", 1001, { trend: 0.00005 });
      t.tick(20 * 60_000);
      await t.postAll(1001);
      t.conserved();
    }
    // a gap in AEI only: its producer is down 40 minutes; the gap bar (open hour: the posted candle) crosses Bob's 20× long
    t.tick(60_000);
    await t.post("abi", 1001);
    await t.post("aii", 1001);
    t.tick(40 * 60_000);
    const lp = b2.position.liq as number;
    const gap = await t.post("aei", 1001, { candle: [1001, 1002, lp - 10, 1001, 3, 12.5] });
    expect(gap.body.gapBars).toBeGreaterThan(0);
    expect(gap.body.liquidated).toBe(1);
    expect(t.db.q("SELECT market, reason FROM positions WHERE reason IS NOT NULL")).toEqual([{ market: "aei", reason: "liquidation" }]);
    await t.post("abi", 1001);
    await t.post("aii", 1001);
    t.conserved();
    // Alice closes her ABI long and AII short
    await t.closeIn("abi", c.alice, a1.order.positionId, 1004);
    await t.closeIn("aii", c.alice, a2.order.positionId, 995);
    t.conserved();
    // to Monday 01:00 UTC: one post per market books its hours (48 at most) and splits its week
    t.tick((weekStart(t.nowS()) + 7 * 86400 + 3600 + 30 - t.nowS()) * 1000);
    for (const m of ["abi", "aii", "aei"] as const) expect((await t.post(m, 1001, { trend: 0.0001 })).status).toBe(200);
    const W = weekStart(t.nowS()) - 7 * 86400;
    // each market split its own week once (the first posts on Saturday split the week before, empty)
    expect(t.db.q("SELECT market, week FROM splits WHERE week = ? ORDER BY market", W)).toEqual([{ market: "abi", week: W }, { market: "aei", week: W }, { market: "aii", week: W }]);
    expect(t.db.q("SELECT market, pool FROM splits WHERE week < ? ORDER BY market", W)).toEqual([{ market: "abi", pool: 0 }, { market: "aei", pool: 0 }, { market: "aii", pool: 0 }]);
    for (const m of ["abi", "aii", "aei"] as const) {
      const sp = t.one<Json>("SELECT pool, insurance FROM splits WHERE market = ? AND week = ?", m, W);
      expect(sp.pool).toBeGreaterThan(0);
      expect(t.insurance(m)).toBeCloseTo(sp.insurance, 9);
      expect((await t.economy(m)).lastSplit).toMatchObject({ week: W, pool: sp.pool });
    }
    t.conserved();
    // everyone closes; every market's house catches up
    c = await sign();
    t.tick(5000);
    await t.postAll(1001);
    await t.closeIn("aii", c.bob, b1.order.positionId, 1001);
    const carolPos = t.one<{ id: number }>("SELECT id FROM positions WHERE wallet = ? AND closed_at IS NULL", lc(CAROL)).id;
    await t.closeIn("aei", c.carol, carolPos, 1001);
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions WHERE closed_at IS NULL")).toEqual([{ n: 0 }]);
    await t.bookAll(1001);
    t.conserved(true);
    // each market's economy adds up to its own house book
    for (const m of ["abi", "aii", "aei"] as const) {
      const e = await t.economy(m);
      expect(e.house.unrealized).toBeCloseTo(0, 9);
      expect(e.house.total.all).toBeCloseTo(t.one<{ s: number }>("SELECT SUM(gross) AS s FROM pools WHERE market = ? AND kind IN ('house_pnl', 'house_trueup', 'liq_margin')", m).s, 6);
    }
    expect(Math.max(...t.sizes)).toBeLessThanOrEqual(MAX_BATCH_STATEMENTS);
  });
});

describe("migration 0004 on a database with rows from 0001–0003", () => {
  const dir = resolve(__dirname, "../migrations");
  test("applies cleanly and keeps every existing row as market abi; AII and AEI start empty", () => {
    const db = new MemoryD1(MIGRATIONS.slice(0, 3).map((f) => resolve(dir, f)));
    const q = (sql: string, ...p: unknown[]) => db.q(sql, ...p);
    // what the live database holds: the mark row, bars, rates (one with a NULL premium from before 0003), a gap, a
    // booked hour, an account with an open and a closed position, orders, ledger rows and pools, a split
    q("INSERT INTO mark (id, px, ts, received_ms, head, hour_start, ch24, ch1, sigma_1h, sigma_24h, funding_known, funding_rate, bars_minute, swept_minute, base_pending, base_step_ts, milestone_ts, candle, post) VALUES (1, 1000.5, 1760097600, 1760097600123, 99, 1760094000, 0.01, 0.001, 0.0004, 0.002, 1, -0.0001, 1760097540, 1760097540, 0, NULL, NULL, '[1,2,0.5,1,3,4]', 'p1')");
    for (let i = 0; i < 5; i++) q("INSERT INTO bars (minute, h, l, c) VALUES (?, 1001, 999, 1000)", 1760097300 + i * 60);
    q("INSERT INTO rates (hour, long, short, skew, r, r_max, cut, house_exposure, house_funding, trend, sigma_1h, L, S, fixed_at, post) VALUES (1760090400, 0.0001, -0.0001, 0, 0, 0.0001, 0, 0, 0, 0.0001, 0.0004, 0, 0, 1760090405, 'p0')");
    q("INSERT INTO rates (hour, long, short, skew, r, r_max, cut, house_exposure, house_funding, trend, sigma_1h, L, S, fixed_at, post, premium) VALUES (1760094000, 0.0002, -0.0001, 0.5, 0.0001, 0.0002, 0.05, -500, 0.1, 0.0001, 0.0004, 1000, 500, 1760094005, 'p1', 0.00001)");
    q("INSERT INTO gaps (minute_from, minute_to) VALUES (1760000000, 1760000600)");
    q("INSERT INTO house_hours (hour, open, close, exposure, price_pnl, funding, pnl, adj, total, cum, cum_price, cum_funding, cum_trueup, cum_liq, upto_id, booked_at, post) VALUES (1760090400, 1000, 1001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1760094005, 'p1')");
    q("INSERT INTO accounts (wallet, balance, season, created) VALUES ('0xaa', 8999.5, 1, 1)");
    q("INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to) VALUES ('0xaa', 'long', 1000, 2, 2000, 1000, 505, 1760090000, 0.2, 1760094000)");
    q("INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, closed_at, exit, pnl, fee, returned, reason, booked_to, settle) VALUES ('0xaa', 'short', 10, 1, 10, 1000, 1990, 1, 2, 1000, 0, 0.002, 9.998, 'close', 2, 's')");
    q("INSERT INTO orders (wallet, kind, side, margin, lev, position_id, arrived_ms, status) VALUES ('0xaa', 'open', 'long', 1000, 2, 1, 1760090000000, 'filled')");
    q("INSERT INTO ledger (ts, kind, amount, ref) VALUES (1760090000, 'fee', 0.2, 'open:1'), (1760094005, 'cut', 0.05, 'hour:1760094000'), (1760094005, 'house_pnl', 0, 'hour:1760090400')");
    q("UPDATE pools SET balance = 0.2, gross = 0.2 WHERE kind = 'fee'");
    q("UPDATE pools SET balance = 0.05, gross = 0.05 WHERE kind = 'cut'");
    q("INSERT INTO splits (week, ts, pool, fee, borrow, cut, house, insurance, treasury, buyback, post) VALUES (1759104000, 1759708900, 0, 0, 0, 0, 0, 0, 0, 0, 's0')");
    const tables = ["mark", "bars", "rates", "gaps", "house_hours", "positions", "orders", "ledger", "pools", "splits", "accounts"];
    const before = Object.fromEntries(tables.map((x) => [x, q(`SELECT * FROM ${x} ORDER BY rowid`)]));

    db.sqlite.exec(readFileSync(resolve(dir, MIGRATIONS[3]), "utf8"));

    // every row is still there, unchanged, now in market abi (mark loses only its id = 1)
    const strip = (rows: Json[], drop: string[] = []) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "market" && !drop.includes(k))));
    for (const x of tables) {
      const after = q(`SELECT * FROM ${x}${x === "pools" ? " WHERE market = 'abi'" : ""} ORDER BY rowid`);
      expect(strip(after), x).toEqual(strip(before[x], x === "mark" ? ["id"] : []));
      if (x !== "accounts") expect([...new Set(after.map((r: Json) => r.market))], x).toEqual(["abi"]);
    }
    expect(q("SELECT market, COUNT(*) AS n, SUM(balance) AS b, SUM(gross) AS g FROM pools GROUP BY market ORDER BY market")).toEqual([
      { market: "abi", n: 10, b: 0.25, g: 0.25 }, { market: "aei", n: 10, b: 0, g: 0 }, { market: "aii", n: 10, b: 0, g: 0 },
    ]);
    // the new keys: the same minute, hour, week and ledger ref may repeat in another market, never in the same one
    q("INSERT INTO bars (market, minute, h, l, c) VALUES ('aii', 1760097300, 1, 1, 1)");
    expect(() => q("INSERT INTO bars (market, minute, h, l, c) VALUES ('abi', 1760097300, 1, 1, 1)")).toThrow(/UNIQUE/);
    q("INSERT INTO ledger (ts, kind, amount, ref, market) VALUES (1, 'cut', 0.01, 'hour:1760094000', 'aei')");
    expect(() => q("INSERT INTO ledger (ts, kind, amount, ref, market) VALUES (1, 'cut', 0.01, 'hour:1760094000', 'abi')")).toThrow(/UNIQUE/);
    q("INSERT INTO mark (market, px, ts, received_ms, head, hour_start, ch24, ch1, candle, post) VALUES ('aii', 1, 1, 1, 1, 0, 0, 0, '[]', 'x')");
    expect(() => q("INSERT INTO mark (market, px, ts, received_ms, head, hour_start, ch24, ch1, candle, post) VALUES ('xyz', 1, 1, 1, 1, 0, 0, 0, '[]', 'x')")).toThrow(/CHECK/);
    // the indexes the reads use, market leading
    const plan = (sql: string, ...p: unknown[]) => q(`EXPLAIN QUERY PLAN ${sql}`, ...p).map((r: Json) => r.detail).join(" | ");
    expect(plan("SELECT * FROM positions WHERE market = ? AND closed_at IS NULL ORDER BY id", "abi")).toMatch(/positions_market/);
    expect(plan("SELECT * FROM orders WHERE market = ? AND status = 'pending' AND arrived_ms < ? ORDER BY id", "abi", 1)).toMatch(/orders_pending/);
    expect(plan("SELECT minute FROM bars INDEXED BY bars_l WHERE market = ? AND l <= ? AND minute >= ? ORDER BY minute LIMIT 500", "abi", 1, 0)).toMatch(/bars_l \(market=\? AND l<\?\)/);
    // the site keeps working on the migrated rows: the open position's rates load from ABI's
    expect(q("SELECT hour FROM rates WHERE market = 'abi' ORDER BY hour").map((r: Json) => r.hour)).toEqual([1760090400, 1760094000]);
  });
});

describe("the edge cache keys funding and economy by market", () => {
  test("?market=aii is not served ABI's cached copy", async () => {
    const t = three();
    await t.post("abi", 1000, { trend: -0.0002 });
    await t.post("aii", 1000, { trend: 0.0003 });
    const { MemoryCache } = await import("./memory-cache");
    const cache = new MemoryCache() as unknown as Cache;
    const get = async (q: string) => (await (await handleFunding(t.req(`/api/pilot/funding${q}`), t.env, { ...t.deps, cache })).json()) as Json;
    expect((await get("")).current.trend).toBe(-0.0002);
    expect((await get("?market=aii")).current.trend).toBe(0.0003);
    expect((await get("?market=abi")).current.trend).toBe(-0.0002);
    expect((await get("?market=aii&x=1")).current.trend).toBe(0.0003);
  });
});
