import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, test, vi } from "vitest";
import * as Engine from "../../src/lib/abi-pilot";
import type { EconomyView } from "../../src/lib/abi-pilot-api";
import type { D1PreparedStatement } from "../lib/env";
import { closeStmts, handleAccount, handleEconomy, handleFunding, loadRates, MAX_BATCH_STATEMENTS, weekStart } from "../lib/pilot";
import { SQL } from "../lib/pilot-sql";
import { BOB, lc, ONE, setup, SNAP, type Json } from "./pilot-harness";

/**
 * Economy v3 on the site (plan R2–R7, spec §9.14, review fixes): the hourly close (rates fixed once from the
 * time-weighted book, the projected cut, the house's hours with price, funding and true-up lines), settlement with
 * funding + borrow, insurance that never goes negative, the late-rate guard, the realized-only weekly split, the
 * batch cap, the economy endpoint, and conservation of points over scripted scenarios that run every money path.
 */
// Anvil's dev keys: never real funds.
const KEYS = [
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
] as const;
const [CAROL, DAN, ERIN, FRANK] = KEYS.map((k) => privateKeyToAccount(k));

type Row = { side: Engine.Side; notional: number; margin: number; lev: number; entry: number; opened_at: number; closed_at: number | null; reason: string | null; liq: number; id: number };

function v3() {
  const t = setup();
  for (const a of [CAROL, DAN, ERIN, FRANK]) {
    t.balances.set(`${lc(a)}@latest`, ONE);
    t.balances.set(`${lc(a)}@0x${SNAP.toString(16)}`, ONE);
  }
  // every batch's size (review S2: none may pass MAX_BATCH_STATEMENTS)
  const sizes: number[] = [];
  const realBatch = t.db.batch.bind(t.db);
  // a hook run once, right before the first batch it matches (races made deterministic)
  let before: { when: (sql: string[]) => boolean; run: () => Promise<void> } | null = null;
  t.db.batch = (async (stmts: D1PreparedStatement[]) => {
    sizes.push(stmts.length);
    const sql = stmts.map((x) => (x as unknown as { sql: string }).sql);
    if (before && before.when(sql)) { const f = before.run; before = null; await f(); }
    return realBatch(stmts);
  }) as typeof t.db.batch;
  // the index file: flat 1000 hourly candles for ten days (no gap stays open), with overrides
  const h0 = Math.floor(t.nowS() / 3600) * 3600;
  const candles = (over: Record<number, [number, number, number]> = {}) =>
    t.setCandles(Array.from({ length: 240 }, (_, i) => { const h = h0 - 24 * 3600 + i * 3600; const o = over[h]; return [h, o?.[0] ?? 1000, o?.[1] ?? 1000, o?.[2] ?? 1000]; }));
  void candles();
  const minute = () => Math.floor(t.nowS() / 60) * 60;
  const hour = () => Math.floor(t.nowS() / 3600) * 3600;
  const one = <T,>(sql: string, ...p: unknown[]) => t.db.q<T>(sql, ...p)[0];
  /** Σ (balance − start) over every account: the traders' side of the conservation check. */
  const traders = () => one<{ d: number }>("SELECT COALESCE(SUM(balance - 10000), 0) AS d FROM accounts").d;
  const ledger = () => one<{ s: number }>("SELECT COALESCE(SUM(amount), 0) AS s FROM ledger").s;
  const pools = () => one<{ s: number }>("SELECT SUM(balance) AS s FROM pools").s;
  const insurance = () => one<{ s: number }>("SELECT SUM(balance) AS s FROM pools WHERE kind IN ('split_insurance', 'insurance_draw')").s;
  const rows = (ref: string) => t.db.q<{ kind: string; amount: number }>("SELECT kind, amount FROM ledger WHERE ref = ? ORDER BY kind", ref);
  const amount = (ref: string, kind: string) => t.db.q<{ amount: number }>("SELECT amount FROM ledger WHERE ref = ? AND kind = ?", ref, kind)[0]?.amount;
  const positions = () => t.db.q<Row>("SELECT id, side, notional, margin, lev, entry, opened_at, closed_at, reason, liq FROM positions");
  const enginePos = (r: Row): Engine.PilotPosition => ({ side: r.side, margin: r.margin, lev: r.lev, notional: r.notional, entry: r.entry, openedAt: r.opened_at, liq: r.liq });
  const tw = (from: number) => Engine.bookTW(positions().map((r) => ({ side: r.side, notional: r.notional, openedAt: r.opened_at, closedAt: r.closed_at })), from, from + 3600);
  const economy = async () => (await (await handleEconomy(t.req("/api/pilot/economy"), t.env, t.deps)).json()) as EconomyView;
  /** To the given minute (and second) of the next hour (the first post with a trend there fixes its rates). */
  const nextHour = (min = 0, sec = 5) => t.tick((hour() + 3600 + min * 60 + sec - t.nowS()) * 1000);
  /** Posts every hour (with a trend) until the house has booked the hour before the current one. */
  const bookAll = async (px = 1000, { positions: all = true } = {}) => {
    for (let i = 0; i < 12; i++) {
      const booked = one<{ h: number | null }>("SELECT MAX(hour) AS h FROM house_hours").h;
      const behind = all ? t.db.q("SELECT id FROM positions WHERE closed_at IS NULL AND booked_to < ?", hour()).length : 0;
      // every earlier fixed hour is booked; with nothing open the current hour's projected cut must be zero too
      const open = t.db.q("SELECT id FROM positions WHERE closed_at IS NULL").length;
      const pending = one<{ s: number }>("SELECT COALESCE(SUM(ABS(cut)), 0) AS s FROM rates WHERE hour NOT IN (SELECT hour FROM house_hours) AND hour < ?", open ? hour() : hour() + 3600).s;
      if (booked === hour() - 3600 && !behind && pending === 0) return;
      nextHour(0, 20);
      expect((await t.markJson(px, { trend: 0 })).status).toBe(200);
    }
    throw new Error("the house never caught up");
  };
  /**
   * Conservation at any moment: Σ balance changes + Σ ledger + what the open positions hold (margin) − the house's
   * and the cut's claim booked on them − the projected cut of fixed hours not yet booked = 0. With every position
   * settled and every fixed hour booked it is Σ balance changes + Σ ledger = 0.
   */
  const conserved = (strict = false) => {
    expect(insurance()).toBeGreaterThanOrEqual(0);
    const open = one<{ m: number; b: number }>("SELECT COALESCE(SUM(margin), 0) AS m, COALESCE(SUM(booked + booked_cut), 0) AS b FROM positions WHERE closed_at IS NULL");
    const pending = one<{ s: number }>("SELECT COALESCE(SUM(cut), 0) AS s FROM rates WHERE hour NOT IN (SELECT hour FROM house_hours)").s;
    expect(traders() + ledger() + open.m - open.b - pending).toBeCloseTo(0, 6);
    if (strict) {
      expect(open.m).toBe(0);
      expect(traders() + ledger()).toBeCloseTo(0, 6);
    }
    expect(pools()).toBeCloseTo(ledger(), 6);
  };
  return {
    ...t, sizes, minute, hour, one, traders, ledger, pools, insurance, rows, amount, positions, enginePos, tw, economy, nextHour, bookAll, conserved, candles,
    /** Run `run` once, right before the first batch whose statements match `when` (default: any). */
    setBefore: (run: () => Promise<void>, when: (sql: string[]) => boolean = () => true) => { before = { when, run }; },
  };
}

describe("hourly close (R2, §9.14a)", () => {
  test("rates are fixed once per hour, at the first non-null trend; a null trend changes nothing", async () => {
    const t = v3();
    const h = t.hour();
    expect((await t.markJson(1000, { trend: null })).body.fixed).toBe(false);
    expect(t.one("SELECT COUNT(*) AS n FROM rates")).toEqual({ n: 0 });
    expect(t.one("SELECT COUNT(*) AS n FROM house_hours")).toEqual({ n: 0 });
    expect(t.db.q("SELECT kind FROM ledger")).toEqual([]);
    expect(t.db.q("SELECT funding_known FROM mark")).toEqual([{ funding_known: 0 }]);
    t.tick(5000);
    expect((await t.markJson(1000, { trend: -0.0002 })).body.fixed).toBe(true);
    t.tick(5000);
    expect((await t.markJson(1000, { trend: 0.0004 })).body.fixed).toBe(false);
    t.tick(5000);
    expect((await t.markJson(1000, { trend: null })).body.fixed).toBe(false);
    expect(t.db.q("SELECT hour, trend, sigma_1h FROM rates")).toEqual([{ hour: h, trend: -0.0002, sigma_1h: 0.0004 }]);
    expect(t.db.q("SELECT funding_known, funding_rate FROM mark")).toEqual([{ funding_known: 1, funding_rate: -0.0002 }]);
    expect(t.db.q("SELECT hour, pnl, adj, total FROM house_hours")).toEqual([{ hour: h - 3600, pnl: 0, adj: 0, total: 0 }]);
  });

  test("review S1: a post whose hour_start goes backwards is refused; a lagging hour_start or funding_hour fixes nothing; nothing is minted", async () => {
    const t = v3();
    const alice = await t.signIn();
    await t.mark(1000);
    const a = await t.open(alice, { side: "long", margin: 1000, lev: 10 }, 1000);
    t.nextHour();
    const H1 = t.hour();
    await t.mark(1000, { trend: null });
    t.tick(20 * 60_000);
    await t.mark(1000, { trend: null }); // H1: null all hour
    t.nextHour();
    const H2 = t.hour();
    // a producer still on H1 while its clock is in H2: accepted, but it fixes nothing
    expect((await t.markJson(1000, { trend: 0.0002, hour_start: H1, funding_hour: H1 })).body).toMatchObject({ fixed: false });
    t.tick(5000);
    expect((await t.markJson(1000, { trend: 0.0001 })).body.fixed).toBe(true); // fixes H2, books H1 (no rates)
    t.tick(5000);
    // the reviewer's repro: a stale post for the booked hour H1
    const stale = await t.markJson(1000, { trend: 0.0002, hour_start: H1, funding_hour: H1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/hour_start/);
    expect(t.db.q("SELECT hour FROM rates ORDER BY hour").map((r: Json) => r.hour)).toEqual([H1 - 3600, H2]);
    t.tick(5000);
    await t.mark(1000);
    expect((await t.close(alice, a.body.order.positionId, 1000)).body.order.status).toBe("filled");
    await t.bookAll();
    t.conserved(true);
  });

  test("the rates come from the time-weighted book of the closing hour; the house's hour books price and the funding actually paid", async () => {
    const t = v3();
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.mark(1000);
    await t.open(alice, { side: "long", margin: 1000, lev: 10 }, 1000);
    const b = await t.open(bob, { side: "short", margin: 300, lev: 10 }, 1000);
    // Bob closes a minute before the close: he still counts for the time he was open (§9.14a)
    t.tick((t.hour() + 3540 - t.nowS()) * 1000);
    await t.mark(1000);
    expect((await t.close(bob, b.body.order.positionId, 1000)).body.order.status).toBe("filled");
    t.nextHour();
    const H = t.hour();
    const { L, S } = t.tw(H - 3600);
    expect(S).toBeGreaterThan(2900);
    expect(S).toBeLessThan(3000);
    await t.mark(1002, { trend: -0.0001 });
    const fr = Engine.fundingRates({ L, S, trend: -0.0001, sigma1h: 0.0004 });
    expect(t.db.q("SELECT long, short, skew, r, cut, L, S, house_exposure FROM rates WHERE hour = ?", H)).toEqual([
      { long: fr.long, short: fr.short, skew: fr.skew, r: fr.r, cut: fr.cut, L, S, house_exposure: fr.houseExposure },
    ]);
    expect(t.rows(`hour:${H}`)).toEqual([{ kind: "cut", amount: fr.cut }]);
    t.nextHour(1);
    await t.mark(1001, { trend: -0.0001 });
    // hour H: price from houseHour on the flat candle (0); funding = what Alice paid in the hour, less the cut
    const pos = t.enginePos(t.positions().find((r) => r.side === "long")!);
    const rh = [{ t: H, long: fr.long, short: fr.short, r: fr.r }];
    const funding = Engine.fundingPaid(pos, rh, H + 3600) - (fr.r > 0 ? 0.1 * Math.abs(fr.r) * 10000 : 0);
    const booked = t.one<Json>("SELECT price_pnl, funding, pnl, adj FROM house_hours WHERE hour = ?", H);
    expect(booked.price_pnl).toBe(0);
    expect(booked.funding).toBeCloseTo(funding, 9);
    expect(booked.pnl).toBeCloseTo(funding, 9);
    expect(booked.adj).toBeCloseTo(0, 9); // Alice held the whole hour at 1000 from entry 1000: nothing to true up
    expect(t.amount(`hour:${H}`, "house_pnl")).toBeCloseTo(funding, 9);
    expect(t.amount(`hour:${H}:adj`, "house_trueup") ?? 0).toBeCloseTo(0, 9);
  });

  test("a position the post's sweep liquidates in the closing hour counts in the book only until its bar", async () => {
    const t = v3();
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.mark(1000);
    const a = await t.open(alice, { side: "long", margin: 1000, lev: 20 }, 1000);
    await t.open(bob, { side: "short", margin: 100, lev: 2 }, 1000);
    t.nextHour();
    const H = t.hour(), liq = a.body.position.liq as number;
    // the hour's first post carries its last minute, finished: it crosses Alice's price
    const r = await t.markJson(1000, { bars: [[H - 60, 1000, liq - 1, 1000], [H, 1000, 1000, 1000]], trend: 0 });
    expect(r.body).toMatchObject({ liquidated: 1, fixed: true });
    const { L, S } = t.tw(H - 3600);
    expect(t.positions().find((x) => x.side === "long")!.closed_at).toBe(H - 60);
    expect(t.db.q("SELECT L, S FROM rates WHERE hour = ?", H)).toEqual([{ L, S }]);
    expect(L).toBeLessThan(20000);
  });

  test("two concurrent posts write one rates row and one set of ledger rows", async () => {
    const t = v3();
    const alice = await t.signIn();
    await t.mark(1000);
    await t.open(alice, { side: "long", margin: 1000, lev: 10 }, 1000);
    t.nextHour();
    const H = t.hour();
    await t.mark(1000, { trend: null });
    t.tick(5000);
    const m = t.minute();
    const bars = [[m - 60, 1000, 1000, 1000], [m, 1000, 1000, 1000]];
    const [a, b] = await Promise.all([t.markJson(1000, { bars, trend: 0.0001, ts: t.nowS() - 1 }), t.markJson(1000, { bars, trend: 0.0003 })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]); // the loser's batch aborted on purpose: a position moved under it
    expect(t.db.q("SELECT hour, trend FROM rates WHERE hour = ?", H)).toEqual([{ hour: H, trend: 0.0001 }]);
    expect(t.one("SELECT COUNT(*) AS n FROM house_hours WHERE hour = ?", H - 3600)).toEqual({ n: 1 });
    expect(t.rows(`hour:${H}`)).toHaveLength(1);
    t.tick(5000);
    expect((await t.markJson(1000, { trend: 0.0009 })).body.fixed).toBe(false);
    expect(t.one("SELECT COUNT(*) AS n FROM rates WHERE hour = ?", H)).toEqual({ n: 1 });
  });
});

describe("late-rate guard (§9.14c)", () => {
  test("until the hour's rates are fixed, closes are refused; the fix's sweep re-checks the hour's bars with them and stamps the crossing at its bar", async () => {
    const t = v3();
    const alice = await t.signIn();
    await t.mark(1000);
    const a = await t.open(alice, { side: "long", margin: 300, lev: 30 }, 1000);
    const id = a.body.order.positionId as number;
    t.nextHour();
    const H = t.hour();
    await t.mark(1000, { trend: null });
    const refused = await t.submitClose(alice, id);
    expect(refused.status).toBe(503);
    expect(refused.body.error).toBe("price updating");
    // the bar of minute H crosses only once hour H's funding counts (trend 1%/h, a book all long)
    const p = t.enginePos(t.positions()[0]);
    const before = await loadRates(t.db, p.openedAt);
    const { L, S } = t.tw(H - 3600);
    const fr = Engine.fundingRates({ L, S, trend: 0.01, sigma1h: 0.0004 });
    const withH = [...before, { t: H, long: fr.long, short: fr.short, r: fr.r }];
    const lpNo = Engine.liqPrice(p, Engine.fundingPaid(p, before, H + 60) + Engine.borrowPaid(p, H + 60));
    const lpH = Engine.liqPrice(p, Engine.fundingPaid(p, withH, H + 60) + Engine.borrowPaid(p, H + 60));
    expect(lpH - lpNo).toBeGreaterThan(0.05);
    const low = (lpNo + lpH) / 2;
    t.tick(60_000);
    expect((await t.markJson(1000, { bars: [[H, 1000, low, 1000], [H + 60, 1000, 1000, 1000]], trend: null })).body.liquidated).toBe(0);
    expect(t.positions()[0].closed_at).toBeNull();
    t.tick(5000);
    const fix = await t.markJson(1000, { bars: [[H + 60, 1000, 1000, 1000]], trend: 0.01 });
    expect(fix.body).toMatchObject({ fixed: true, liquidated: 1 });
    expect(t.db.q("SELECT closed_at, reason FROM positions")).toEqual([{ closed_at: H, reason: "liquidation" }]);
    expect(t.db.q("SELECT accrued FROM positions")[0]).toEqual({ accrued: -Engine.fundingPaid(p, withH, H + 60) });
    await t.bookAll();
    t.conserved(true);
  });
});

describe("settlement and insurance (R3, owner item 6)", () => {
  test("a gap insurance cannot cover is a house loss; insurance never goes below zero; a plain liquidation books the equity left", async () => {
    const t = v3();
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.mark(1000);
    const a = await t.open(alice, { side: "long", margin: 300, lev: 30 }, 1000);
    const b = await t.open(bob, { side: "short", margin: 1000, lev: 20 }, 1000);
    t.tick(120_000);
    const m = t.minute();
    const bobLiq = b.body.position.liq as number;
    const r = await t.markJson(1000, { bars: [[m - 60, bobLiq + 0.5, 950, 1000], [m, 1000, 1000, 1000]] });
    expect(r.body.liquidated).toBe(2);
    const rates = await loadRates(t.db, a.body.position.openedAt);
    const bar = [{ t: m - 60, h: bobLiq + 0.5, l: 950, c: 1000 }];
    for (const [x, gap] of [[a, true], [b, false]] as const) {
      const p = x.body.position, id = x.body.order.positionId as number;
      const pos = { side: p.side, margin: p.margin, lev: p.lev, notional: p.notional, entry: p.entry, openedAt: p.openedAt, liq: p.liq };
      const hit = Engine.liquidation(pos, bar, rates)!;
      const end = hit.t + 60, worst = p.side === "long" ? 950 : bobLiq + 0.5;
      const eq = p.margin + Engine.pnl(pos, worst) - (Engine.fundingPaid(pos, rates, end) + Engine.borrowPaid(pos, end));
      expect(hit.shortfall > 0).toBe(gap);
      // insurance is empty: the whole gap is the house's (liq_margin = equity, negative); the draw is 0
      expect(t.amount(`liq:${id}`, "liq_margin")).toBeCloseTo(eq, 9);
      if (gap) expect(t.amount(`draw:${id}`, "insurance_draw")).toBe(0);
      else expect(t.amount(`draw:${id}`, "insurance_draw")).toBeUndefined();
      expect(t.amount(`borrow:${id}`, "borrow")).toBeCloseTo(Engine.borrowPaid(pos, end), 12);
      expect(t.db.q("SELECT fill, returned, reason FROM positions WHERE id = ?", id)).toEqual([{ fill: worst, returned: 0, reason: "liquidation" }]);
    }
    expect(t.insurance()).toBe(0);
    const e = await t.economy();
    expect(e.house.unrealized).toBe(0);
    expect(e.pool.house).toBeCloseTo(Math.max(0, e.house.realized), 9);
    t.conserved(true);
  });
});

describe("weekly split (R5, §9.14b)", () => {
  test("once for the week that ended, under concurrent requests, per splitFees; the house's open mark-to-market is not split", async () => {
    const t = v3();
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.mark(1000);
    const o = await t.open(alice, { side: "long", margin: 1000, lev: 10 }, 1000);
    await t.open(bob, { side: "long", margin: 1000, lev: 5 }, 1000);
    t.tick(30 * 60_000);
    await t.mark(1001);
    await t.close(alice, o.body.order.positionId, 1004); // Alice realizes +40 against the house
    // the index closes the hour at 990: the house books +50 on Bob's open long, unrealized
    const H0 = t.hour();
    await t.candles({ [H0]: [1001, 989, 990] });
    t.nextHour();
    await t.mark(990);
    const W = weekStart(t.nowS());
    expect(t.db.q("SELECT week, pool FROM splits")).toEqual([{ week: W - 7 * 86400, pool: 0 }]);
    const e0 = await t.economy();
    expect(e0.house.unrealized).toBeGreaterThan(40);
    expect(e0.house.realized).toBeLessThan(0); // Alice's gain, net of the cut and funding: the house lost it
    // to Monday 00:00 UTC + 1 minute: three public reads race
    t.tick((W + 7 * 86400 + 60 - t.nowS()) * 1000);
    const bal = Object.fromEntries(t.db.q<{ kind: string; balance: number }>("SELECT kind, balance FROM pools").map((x) => [x.kind, x.balance]));
    const pool = bal.fee + bal.borrow + bal.cut; // the house's realized result is negative: carried, not split
    await Promise.all([t.economy(), t.account(), t.call(handleFunding, t.req("/api/pilot/funding")), t.economy()]);
    const s = Engine.splitFees(pool);
    expect(t.db.q("SELECT week, pool, house, insurance, treasury, buyback FROM splits WHERE week = ?", W)).toEqual([{ week: W, pool, house: 0, insurance: s.insurance, treasury: s.treasury, buyback: s.buyback }]);
    const split = Object.fromEntries(t.rows(`split:${W}`).map((x) => [x.kind, x.amount]));
    expect(split).toMatchObject({ split_insurance: s.insurance, split_treasury: s.treasury - s.buyback, split_buyback: s.buyback, fee: -bal.fee, cut: -bal.cut });
    expect(split.house_pnl).toBeUndefined();
    // after the split each fee-pool source is exactly what is unsplit (review N6): zero here
    for (const k of ["fee", "borrow", "cut"]) expect(t.one<{ balance: number }>("SELECT balance FROM pools WHERE kind = ?", k).balance).toBeCloseTo(0, 9);
    const e = await t.economy();
    expect(e.lastSplit).toMatchObject({ week: W, pool, insurance: s.insurance, treasury: s.treasury, buyback: s.buyback });
    expect(e.insurance).toBeCloseTo(s.insurance, 9);
    expect(e.house.realized).toBeCloseTo(e0.house.realized, 9); // carried
    expect(t.pools()).toBeCloseTo(t.ledger(), 9);
  });

  test("a positive realized house result is split; what it still holds on open positions stays", async () => {
    const t = v3();
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.mark(1000);
    const o = await t.open(alice, { side: "long", margin: 1000, lev: 10 }, 1000);
    await t.open(bob, { side: "long", margin: 500, lev: 5 }, 1000);
    t.tick(10 * 60_000);
    await t.mark(990);
    await t.close(alice, o.body.order.positionId, 990); // Alice loses 100 to the house: realized
    // the index stays at 990: the house's claim on Bob's open long is marked there at every booked hour
    const from = t.hour();
    await t.candles(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [from + i * 3600, [990, 990, 990]])));
    const W = weekStart(t.nowS()) + 7 * 86400;
    t.tick((W + 30 - t.nowS()) * 1000);
    await t.mark(990, { trend: 0 }); // the Monday post: fix, book (catch-up), split
    const sp = t.one<Json>("SELECT house, pool FROM splits WHERE week = ?", W - 7 * 86400);
    expect(sp.house).toBeGreaterThan(90);
    const e = await t.economy();
    expect(e.house.unrealized).toBeGreaterThan(0); // Bob's open long, marked at 990: still the house's
    expect(e.house.realized).toBeLessThan(sp.house); // moved out
  });
});

describe("batch cap (review S2)", () => {
  test("a large book and a 48 h+ catch-up: every batch stays under MAX_BATCH_STATEMENTS, nothing is lost, the rest is booked at the next closes", async () => {
    const t = v3();
    await t.mark(1000);
    // 300 open positions written directly, with their debits and open fees, as fills would
    const now = t.nowS();
    for (let i = 0; i < 300; i++) {
      const owner = "0x" + (Math.floor(i / 5) + 1).toString(16).padStart(40, "0"), side = i % 3 ? "long" : "short", fee = 1000 * Engine.RULES.feeRate;
      if (i % 5 === 0) t.db.q("INSERT INTO accounts (wallet, balance, season, created) VALUES (?, 10000, 1, 0)", owner);
      t.db.q("UPDATE accounts SET balance = balance - ? WHERE wallet = ?", 100 + fee, owner);
      const id = t.db.q<{ id: number }>("INSERT INTO positions (wallet, side, margin, lev, notional, entry, liq, opened_at, fee, booked_to) VALUES (?, ?, 100, 10, 1000, 1000, ?, ?, ?, ?) RETURNING id",
        owner, side, side === "long" ? 905 : 1095, now - 60 + (i % 50), fee, now - 60 + (i % 50))[0].id;
      t.db.q("INSERT INTO ledger (ts, kind, amount, ref) VALUES (?, 'fee', ?, ?)", now, fee, `open:${id}`);
      t.db.q("UPDATE pools SET balance = balance + ?, gross = gross + ? WHERE kind = 'fee'", fee, fee);
    }
    // the house's books: claims booked = house rows; cut booked + the projected cut of every fixed, unbooked hour = cut rows
    const invariant = () => {
      // (without the weekly split's own rows, which move balances out of these kinds)
      const house = t.one<{ s: number }>("SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE kind IN ('house_pnl', 'house_trueup', 'liq_margin') AND ref NOT LIKE 'split:%'").s;
      const cut = t.one<{ s: number }>("SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE kind = 'cut' AND ref NOT LIKE 'split:%'").s;
      const booked = t.one<{ b: number; c: number }>("SELECT SUM(booked) AS b, SUM(booked_cut) AS c FROM positions");
      const pending = t.one<{ s: number }>("SELECT COALESCE(SUM(cut), 0) AS s FROM rates WHERE hour NOT IN (SELECT hour FROM house_hours)").s;
      expect(house).toBeCloseTo(booked.b, 6);
      expect(cut).toBeCloseTo(booked.c + pending, 6);
    };
    t.nextHour(0, 20);
    await t.mark(1000, { trend: 0.0001 });
    invariant();
    t.tick(50 * 3600_000); // the producer was down 50 h
    const r = await t.markJson(999, { trend: 0.0002 });
    expect(r.status).toBe(200);
    expect(r.body.statements).toBeLessThanOrEqual(MAX_BATCH_STATEMENTS);
    expect(r.body.statements).toBeGreaterThan(200);
    invariant();
    const booked = t.one<{ n: number }>("SELECT COUNT(*) AS n FROM house_hours").n;
    expect(booked).toBeLessThan(52); // not every hour at once
    await t.bookAll(999, { positions: false }); // every hour booked
    invariant();
    // more open positions than one batch books: they rotate, each booked at least every other hour
    for (let i = 0; i < 3; i++) {
      t.nextHour(0, 20);
      expect((await t.markJson(999, { trend: 0 })).status).toBe(200);
      invariant();
    }
    expect(t.one("SELECT COUNT(*) AS n FROM positions WHERE booked_to < ?", t.hour() - 2 * 3600)).toEqual({ n: 0 });
    expect(Math.max(...t.sizes)).toBeLessThanOrEqual(MAX_BATCH_STATEMENTS);
    t.conserved();
  });

  test("a real batch error is logged with its kind and size and answers 500; the deliberate abort stays a 409", async () => {
    const t = v3();
    await t.mark(1000);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    t.setBefore(async () => { throw new Error("D1_ERROR: too many SQL variables: SQLITE_ERROR"); });
    t.tick(5000);
    const r = await t.markJson(1000);
    expect(r.status).toBe(500);
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/batch failed \(mark, \d+ statements, 0 liquidations\): D1_ERROR: too many SQL variables/));
    spy.mockRestore();
    t.setBefore(async () => { throw new Error("D1_ERROR: NOT NULL constraint failed: ledger.ts: SQLITE_CONSTRAINT"); });
    t.tick(5000);
    expect((await t.markJson(1000)).status).toBe(409);
    t.tick(5000);
    expect((await t.markJson(1000)).status).toBe(200);
  });
});

describe("economy endpoint (R7, owner item 5)", () => {
  test("shape: rates, the house by line (price, funding, true-up, liquidations; 24 h, week, all), realized / open, the pool by source, insurance, splits", async () => {
    const t = v3();
    const alice = await t.signIn();
    await t.mark(1000, { trend: -0.0002 });
    await t.open(alice, { side: "long", margin: 1000, lev: 5 }, 1000);
    t.nextHour();
    await t.mark(1001, { trend: -0.0002 });
    t.nextHour();
    await t.mark(1001, { trend: -0.0002 });
    const e = await t.economy();
    expect(Object.keys(e).sort()).toEqual(["borrowApr", "buyback", "house", "insurance", "lastSplit", "pool", "rates", "treasury", "ts", "week"]);
    expect(Object.keys(e.house).sort()).toEqual(["exposure", "funding", "liquidations", "price", "realized", "total", "trueup", "unrealized"]);
    for (const k of ["price", "funding", "trueup", "liquidations", "total"] as const) expect(Object.keys(e.house[k]).sort()).toEqual(["all", "h24", "week"]);
    expect(e.rates.current).toMatchObject({ t: t.hour(), S: 0, skew: 1 });
    expect(e.rates.current!.L).toBeCloseTo(5000, 6);
    expect(e.house.exposure).toBeCloseTo(-5000, 6);
    // the lines add up to the house's book, which is realized (0: nothing settled) + its claim on the open position
    expect(e.house.total.all).toBeCloseTo(e.house.price.all + e.house.funding.all + e.house.trueup.all + e.house.liquidations.all, 9);
    expect(e.house.total.all).toBeCloseTo(e.house.unrealized + e.house.realized, 9);
    expect(e.house.realized).toBeCloseTo(0, 9);
    expect(e.house.funding.all).toBeGreaterThan(0); // the long pays the skew and the (negative) trend is less
    expect(Object.keys(e.pool).sort()).toEqual(["borrow", "cut", "fee", "house", "total"]);
    expect(e.pool.fee).toBeCloseTo(5000 * Engine.RULES.feeRate, 12);
    expect(e.week).toMatchObject({ start: weekStart(t.nowS()) });
    expect(e.borrowApr).toBe(0.1);
    expect(e.lastSplit).toMatchObject({ pool: 0 });
    expect((await handleEconomy(t.req("/api/pilot/economy", "POST"), t.env, t.deps)).status).toBe(405);
  });
});

describe("conservation (R4, review S3)", () => {
  test("every money path, over days: Σ balance changes + Σ ledger = 0, pools = ledger, insurance ≥ 0", async () => {
    const t = v3();
    const sign = async () => ({ alice: await t.signIn(), bob: await t.signIn(BOB), carol: await t.signIn(CAROL), dan: await t.signIn(DAN), erin: await t.signIn(ERIN), frank: await t.signIn(FRANK) });
    let c = await sign();
    await t.mark(1000, { trend: -0.0002 }); // Saturday 12:00 UTC
    const a = await t.open(c.alice, { side: "long", margin: 1000, lev: 10 }, 1000);
    const b = await t.open(c.bob, { side: "short", margin: 500, lev: 20 }, 1001);
    await t.open(c.carol, { side: "long", margin: 300, lev: 30 }, 1002);
    t.tick(20 * 60_000);
    await t.mark(1003);

    // 13:05: the hour's fix (time-weighted book), the hour before booked
    t.nextHour(5);
    await t.mark(1004, { trend: -0.0001 });
    // a gap liquidation while insurance is empty: the house carries it
    t.tick(60_000);
    let m = t.minute();
    expect((await t.markJson(1000, { bars: [[m - 60, 1004, 950, 1000], [m, 1000, 1000, 1000]] })).body.liquidated).toBe(1);
    expect(t.insurance()).toBe(0);
    // lazy liquidation: a bar written behind the ingest's back crosses Alice; her next read settles it
    t.tick(60_000);
    await t.mark(1000);
    m = t.minute();
    const aliceLiq = a.body.position.liq as number;
    t.db.q("INSERT OR REPLACE INTO bars (minute, h, l, c) VALUES (?, 1000, ?, 1000)", m - 60, aliceLiq - 3);
    t.db.q("UPDATE mark SET swept_minute = ?", m - 120);
    expect((await t.account(c.alice)).body.positions).toEqual([]);
    expect(t.db.q("SELECT reason FROM positions WHERE id = ?", a.body.order.positionId)).toEqual([{ reason: "liquidation" }]);
    // a liquidation in the open minute of a close: Dan's close is refused "already closed"
    t.tick(5000);
    await t.mark(1000);
    const d1 = await t.open(c.dan, { side: "long", margin: 1000, lev: 20 }, 1000);
    t.tick(60_000);
    await t.mark(1000);
    const dc = await t.submitClose(c.dan, d1.body.order.positionId);
    expect(dc.status).toBe(202);
    t.tick(1000);
    m = t.minute();
    await t.markJson(1000, { bars: [[m - 60, 1000, 1000, 1000], [m, 1000, (d1.body.position.liq as number) - 1, 1000]] });
    expect((await t.status(c.dan, dc.body.order.id)).body.order).toMatchObject({ status: "refused", error: "already closed" });
    expect(t.db.q("SELECT reason FROM positions WHERE id = ?", d1.body.order.positionId)).toEqual([{ reason: "liquidation" }]);
    t.conserved();

    // 14:00–15:00: an hour with no rates row (the producer never confirms its close); closes are refused meanwhile
    t.nextHour(5);
    await t.mark(1002, { trend: null });
    expect((await t.submitClose(c.bob, b.body.order.positionId)).body.error).toBe("price updating");
    t.tick(30 * 60_000);
    await t.mark(1001, { trend: null });
    // 15:00: fixed again; the hours before are booked (one without rates)
    t.nextHour(5);
    await t.mark(1001, { trend: 0.0001 });
    const e1 = await t.open(c.erin, { side: "long", margin: 1000, lev: 5 }, 1001); // held over the weekend

    // a close racing the hourly booking, both ways:
    // (1) Bob's close settles between the 16:00 fix's reads and its batch: the booking aborts (409), the re-post books
    t.tick((t.hour() + 3598 - t.nowS()) * 1000);
    await t.mark(1001);
    const bc = await t.submitClose(c.bob, b.body.order.positionId);
    expect(bc.status).toBe(202);
    const bobRow = () => t.db.q<Json>("SELECT * FROM positions WHERE id = ?", b.body.order.positionId)[0];
    t.setBefore(async () => {
      const row = bobRow();
      const res = await t.db.batch(closeStmts(t.db, row as never, { id: bc.body.order.id, wallet: lc(BOB) }, { mark: 1001, ts: t.nowS() - 2 }, await loadRates(t.db, row.opened_at)));
      expect(res[0].meta.changes).toBe(1);
    }, (sql) => sql.includes(SQL.bookPosition));
    t.nextHour(0, 7);
    const lost = await t.markJson(1001, { trend: 0.0001 });
    expect(lost.status).toBe(409);
    expect(lost.body.error).toMatch(/changed meanwhile/);
    expect(t.one("SELECT COUNT(*) AS n FROM rates WHERE hour = ?", t.hour())).toEqual({ n: 0 }); // nothing written
    t.tick(2000);
    expect((await t.markJson(1001, { trend: 0.0001 })).body.fixed).toBe(true);
    expect((await t.status(c.bob, bc.body.order.id)).body.order.status).toBe("filled");
    t.conserved();
    // (2) Erin's booking moves while her close is being filled: the close re-reads and settles once
    t.tick(60_000);
    await t.mark(1001);
    const ec = await t.submitClose(c.erin, e1.body.order.positionId);
    t.setBefore(async () => {
      t.db.q("UPDATE positions SET booked_to = booked_to + 1 WHERE id = ?", e1.body.order.positionId); // a booking landed (same claim)
    }, (sql) => sql[0] === SQL.closeSettle);
    t.tick(1000);
    expect((await t.markJson(1001)).body.filled).toBe(1);
    expect((await t.status(c.erin, ec.body.order.id)).body.order.status).toBe("filled");
    const e2 = await t.open(c.erin, { side: "long", margin: 1000, lev: 5 }, 1001); // held over the weekend
    t.conserved();

    // the producer is down 50 h, to Monday 18:00 UTC: one post books 48 hours at most and splits the week
    t.tick(50 * 3600_000);
    const mon = await t.markJson(1003, { trend: 0.0002 });
    expect(mon.status).toBe(200);
    const W = weekStart(t.nowS());
    expect(t.one<{ pool: number }>("SELECT pool FROM splits WHERE week = ?", W - 7 * 86400).pool).toBeGreaterThan(0);
    expect(t.insurance()).toBeGreaterThan(0);
    expect(t.one<{ n: number }>("SELECT COUNT(*) AS n FROM house_hours WHERE hour > ?", W - 7 * 86400).n).toBeGreaterThan(0);
    c = await sign(); // sessions last 12 h

    // a negative close (unreachable through the API: the open bar liquidates first), settled directly: insurance
    // covers what its balance allows, the house carries the rest
    t.tick(5000);
    await t.mark(1003);
    const f = await t.open(c.frank, { side: "long", margin: 300, lev: 30 }, 1003);
    t.tick(5000);
    await t.mark(1003);
    const fc = await t.submitClose(c.frank, f.body.order.positionId);
    const row = t.db.q<Json>("SELECT * FROM positions WHERE id = ?", f.body.order.positionId)[0];
    const ins0 = t.insurance();
    await t.db.batch(closeStmts(t.db, row as never, { id: fc.body.order.id, wallet: lc(FRANK) }, { mark: 900, ts: t.nowS() }, await loadRates(t.db, row.opened_at)));
    const draw = -t.amount(`draw:${row.id}`, "insurance_draw")!;
    expect(draw).toBeCloseTo(Math.min(ins0, -t.amount(`gap:${row.id}`, "house_trueup")! + draw), 9);
    expect(t.insurance()).toBeGreaterThanOrEqual(0);
    expect(t.db.q("SELECT returned, reason FROM positions WHERE id = ?", row.id)).toEqual([{ returned: 0, reason: "close" }]);

    t.conserved();
    // Erin closes; the house catches up hour by hour (the rest of the 50 h)
    t.tick(5000);
    await t.mark(1006);
    expect((await t.close(c.erin, e2.body.order.positionId, 1006)).body.order.status).toBe("filled");
    expect(t.one("SELECT COUNT(*) AS n FROM positions WHERE closed_at IS NULL")).toEqual({ n: 0 });
    await t.bookAll(1006);
    expect(Math.abs(t.traders())).toBeGreaterThan(1);
    t.conserved(true);
    // the house's lines add up to its book; with nothing open it is all realized
    const e = await t.economy();
    expect(e.house.unrealized).toBeCloseTo(0, 9);
    expect(e.house.total.all).toBeCloseTo(t.one<{ s: number }>("SELECT SUM(gross) AS s FROM pools WHERE kind IN ('house_pnl', 'house_trueup', 'liq_margin')").s, 6);
    expect(Math.max(...t.sizes)).toBeLessThanOrEqual(MAX_BATCH_STATEMENTS);
  });

  test("an account poll reads the split state from the mark row join (no extra statement)", async () => {
    const t = v3();
    await t.mark(1000);
    const before = t.db.log.length;
    await handleAccount(t.req("/api/pilot/account"), t.env, t.deps);
    expect(t.db.log.slice(before).filter((x) => /splits/.test(x) && !/FROM mark m/.test(x))).toEqual([]);
    expect(t.db.log.slice(before).some((x) => x === SQL.splitInsert)).toBe(false);
  });
});


describe("milestone premium (§9.15, audit PE-2: longs pay it, the house collects it)", () => {
  test("the long rate includes the premium, the rates row stores it, and the house's funding line holds what longs paid", async () => {
    const t = v3();
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.mark(1000);
    await t.open(alice, { side: "long", margin: 1000, lev: 10 }, 1000);
    await t.open(bob, { side: "short", margin: 300, lev: 10 }, 1000);
    t.nextHour();
    const H = t.hour();
    const { L, S } = t.tw(H - 3600);
    const pm = 0.00005;
    await t.mark(1000, { trend: -0.0001, milestone_premium: pm });
    const fr = Engine.fundingRates({ L, S, trend: -0.0001, sigma1h: 0.0004, premium: pm });
    const plain = Engine.fundingRates({ L, S, trend: -0.0001, sigma1h: 0.0004 });
    expect(fr.long - plain.long).toBeCloseTo(pm, 15);
    expect(fr.short).toBe(plain.short);
    expect(t.db.q("SELECT long, short, premium, house_funding FROM rates WHERE hour = ?", H)).toEqual([{ long: fr.long, short: fr.short, premium: pm, house_funding: fr.houseFunding }]);
    expect(fr.houseFunding - plain.houseFunding).toBeCloseTo(pm * L, 9);
    // the funding view and the ticket's rate: the long rate with the premium in it
    const f = await t.call(handleFunding, t.req("/api/pilot/funding"));
    expect(f.body.current).toMatchObject({ long: fr.long, premium: pm });
    expect((await t.account(alice)).body.funding).toMatchObject({ long: fr.long, short: fr.short });
    expect((await t.economy()).rates.current).toMatchObject({ long: fr.long, premium: pm });
    t.nextHour(1);
    await t.mark(1000, { trend: -0.0001, milestone_premium: pm });
    const longPos = t.enginePos(t.positions().find((r) => r.side === "long")!);
    const shortPos = t.enginePos(t.positions().find((r) => r.side === "short")!);
    const rh = [{ t: H, long: fr.long, short: fr.short, r: fr.r }];
    const paid = Engine.fundingPaid(longPos, rh, H + 3600) + Engine.fundingPaid(shortPos, rh, H + 3600);
    const cutPaid = 0.1 * Math.abs(fr.r) * (fr.heavy === "long" ? longPos.notional : shortPos.notional);
    const booked = t.one<Json>("SELECT funding FROM house_hours WHERE hour = ?", H);
    expect(booked.funding).toBeCloseTo(paid - cutPaid, 9);
    expect(Engine.fundingPaid(longPos, rh, H + 3600) - Engine.fundingPaid(longPos, [{ t: H, long: plain.long, short: plain.short }], H + 3600)).toBeCloseTo(pm * longPos.notional, 9);
    t.conserved();
  });

  test("conservation with a premium > 0: opens, closes, a liquidation, hours booked; Σ balance changes + Σ ledger = 0", async () => {
    const t = v3();
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.mark(1000, { trend: -0.0002, milestone_premium: 0.0001 });
    const a = await t.open(alice, { side: "long", margin: 1000, lev: 10 }, 1000, { milestone_premium: 0.0001 });
    const b = await t.open(bob, { side: "short", margin: 500, lev: 20 }, 1001, { milestone_premium: 0.0001 });
    for (let h = 0; h < 3; h++) {
      t.nextHour(5);
      await t.mark(1000 + h, { trend: 0.0001 * h, milestone_premium: 0.0002 });
      t.tick(30 * 60_000);
      await t.mark(1001 + h, { milestone_premium: 0.0002 });
      t.conserved();
    }
    expect(t.db.q<{ premium: number }>("SELECT premium FROM rates ORDER BY hour").map((r) => r.premium)).toEqual([0.0001, 0.0002, 0.0002, 0.0002]);
    expect((await t.close(alice, a.body.order.positionId, 1003, { milestone_premium: 0.0002 })).body.order.status).toBe("filled");
    // Bob (20× short) is liquidated by a jump
    t.tick(60_000);
    const m = t.minute();
    await t.markJson(1003, { bars: [[m - 60, 1060, 1003, 1003], [m, 1003, 1003, 1003]], milestone_premium: 0.0002 });
    expect(t.db.q("SELECT reason FROM positions WHERE id = ?", b.body.order.positionId)).toEqual([{ reason: "liquidation" }]);
    await t.bookAll(1003);
    t.conserved(true);
  });

  test("an explicit null premium holds the hour's fix (like a null trend); a producer without the key fixes with 0", async () => {
    const t = v3();
    const alice = await t.signIn();
    await t.mark(1000, { trend: -0.0001, milestone_premium: null });
    expect(t.db.q("SELECT COUNT(*) AS n FROM rates")).toEqual([{ n: 0 }]);
    expect((await t.submit(alice, { side: "long", margin: 100, lev: 2 })).body.error).toBe("price updating");
    t.tick(5000);
    await t.mark(1000, { trend: -0.0001, milestone_premium: 0.00003 });
    expect(t.db.q("SELECT long, premium FROM rates")).toEqual([{ long: -0.0001 + 0.00003, premium: 0.00003 }]);
    t.nextHour();
    await t.mark(1000, { trend: -0.0001 });
    expect(t.db.q("SELECT premium FROM rates WHERE hour = ?", t.hour())).toEqual([{ premium: 0 }]);
  });
});
