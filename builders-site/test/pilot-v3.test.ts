import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, test } from "vitest";
import * as Engine from "../../src/lib/abi-pilot";
import type { EconomyView } from "../../src/lib/abi-pilot-api";
import { handleAccount, handleEconomy, handleFunding, weekStart } from "../lib/pilot";
import { BOB, lc, ONE, setup, SNAP, type Json } from "./pilot-harness";

/**
 * Economy v3 on the site (plan R2–R7): the hourly close (rates fixed once, the projected cut, the house's hours and
 * their true-up), settlement with funding + borrow, the gap liquidation's insurance draw, the weekly split, the
 * economy endpoint, and conservation of points over a scripted multi-hour scenario.
 */
// Anvil's third dev key: never real funds.
const CAROL = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

function v3() {
  const t = setup();
  t.balances.set(`${lc(CAROL)}@latest`, ONE);
  t.balances.set(`${lc(CAROL)}@0x${SNAP.toString(16)}`, ONE);
  const minute = () => Math.floor(t.nowS() / 60) * 60;
  const hour = () => Math.floor(t.nowS() / 3600) * 3600;
  /** Σ (balance − start) over every account: the traders' side of the conservation check. */
  const traders = () => t.db.q<{ d: number }>("SELECT COALESCE(SUM(balance - 10000), 0) AS d FROM accounts")[0].d;
  const ledger = () => t.db.q<{ s: number }>("SELECT COALESCE(SUM(amount), 0) AS s FROM ledger")[0].s;
  const pools = () => t.db.q<{ s: number }>("SELECT SUM(balance) AS s FROM pools")[0].s;
  const rows = (ref: string) => t.db.q<{ kind: string; amount: number }>("SELECT kind, amount FROM ledger WHERE ref = ? ORDER BY kind", ref);
  const economy = async () => (await (await handleEconomy(t.req("/api/pilot/economy"), t.env, t.deps)).json()) as EconomyView;
  /** To the given minute of the next hour (the first post there fixes its rates). */
  const nextHour = (min = 0) => t.tick(((hour() + 3600 + min * 60) - t.nowS()) * 1000);
  return { ...t, minute, hour, traders, ledger, pools, rows, economy, nextHour };
}

describe("hourly close (R2)", () => {
  test("rates are fixed once per hour, at the first non-null trend; a null trend changes nothing", async () => {
    const t = v3();
    const h = t.hour();
    const r0 = await t.markJson(1000, { trend: null });
    expect(r0.body.fixed).toBe(false);
    expect(t.db.q("SELECT COUNT(*) AS n FROM rates")[0]).toEqual({ n: 0 });
    expect(t.db.q("SELECT COUNT(*) AS n FROM house_hours")[0]).toEqual({ n: 0 });
    expect(t.db.q("SELECT kind FROM ledger")).toEqual([]);
    expect(t.db.q("SELECT funding_known FROM mark")).toEqual([{ funding_known: 0 }]);
    t.tick(5000);
    expect((await t.markJson(1000, { trend: -0.0002 })).body.fixed).toBe(true);
    t.tick(5000);
    expect((await t.markJson(1000, { trend: 0.0004 })).body.fixed).toBe(false);
    t.tick(5000);
    expect((await t.markJson(1000, { trend: null })).body.fixed).toBe(false);
    expect(t.db.q("SELECT hour, trend, sigma_1h FROM rates")).toEqual([{ hour: h, trend: -0.0002, sigma_1h: 0.0004 }]);
    expect(t.db.q("SELECT funding_known, funding_rate FROM mark")).toEqual([{ funding_known: 1, funding_rate: -0.0002 }]); // a later null does not unfix it
    // the first fix books the hour just closed (empty book): one house_hours row
    expect(t.db.q("SELECT hour, pnl, adj, total FROM house_hours")).toEqual([{ hour: h - 3600, pnl: 0, adj: 0, total: 0 }]);
  });

  test("a trend for an earlier hour (funding_hour < hour_start) fixes nothing", async () => {
    const t = v3();
    await t.mark(1000, { trend: 0.0001, funding_hour: t.hour() - 3600 });
    expect(t.db.q("SELECT COUNT(*) AS n FROM rates")[0]).toEqual({ n: 0 });
  });

  test("the rates come from the traders' book (fundingRates); the projected cut goes to the fee pool; the next close books houseHour − cut plus its true-up", async () => {
    const t = v3();
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.mark(1000);
    await t.open(alice, { side: "long", margin: 1000, lev: 10 }, 1000);
    await t.open(bob, { side: "short", margin: 300, lev: 10 }, 1000);
    t.nextHour();
    const H = t.hour();
    await t.mark(1002, { trend: -0.0001 });
    const fr = Engine.fundingRates({ L: 10000, S: 3000, trend: -0.0001, sigma1h: 0.0004 });
    expect(t.db.q("SELECT long, short, skew, r, cut, L, S, house_exposure FROM rates WHERE hour = ?", H)).toEqual([
      { long: fr.long, short: fr.short, skew: fr.skew, r: fr.r, cut: fr.cut, L: 10000, S: 3000, house_exposure: -7000 },
    ]);
    expect(t.rows(`hour:${H}`)).toEqual([{ kind: "cut", amount: fr.cut }]);
    t.nextHour(1);
    await t.mark(1001, { trend: -0.0001 });
    // hour H booked: houseHour on the stored book and the hour's candle (the index file: flat 1000), net of the cut
    const hh = Engine.houseHour({ L: 10000, S: 3000, open: 1000, close: 1000, trend: -0.0001, sigma1h: 0.0004 });
    const booked = t.db.q<Json>("SELECT open, close, exposure, price_pnl, funding, pnl, adj, total FROM house_hours WHERE hour = ?", H)[0];
    expect(booked).toMatchObject({ open: 1000, close: 1000, exposure: -7000, price_pnl: hh.pricePnl + 0, funding: hh.funding - fr.cut, pnl: hh.total - fr.cut });
    expect(t.rows(`hour:${H}`)).toEqual([{ kind: "cut", amount: fr.cut }, { kind: "house_pnl", amount: hh.total - fr.cut }]);
    // the true-up makes the hour exact: both positions held the whole hour at the rates, marked at 1000 from entry 1000
    expect(booked.adj).toBeCloseTo(0, 9);
    expect(t.db.q<{ amount: number }>("SELECT amount FROM ledger WHERE ref = ? AND kind = 'cut'", `hour:${H}:adj`)[0]?.amount ?? 0).toBeCloseTo(0, 9);
  });

  test("L and S exclude positions the sweep liquidates in the same post", async () => {
    const t = v3();
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.mark(1000);
    const a = await t.open(alice, { side: "long", margin: 1000, lev: 20 }, 1000);
    await t.open(bob, { side: "short", margin: 100, lev: 2 }, 1000);
    t.nextHour(1);
    const m = t.minute();
    const liq = a.body.position.liq as number;
    const r = await t.markJson(1000, { bars: [[m - 60, 1000, liq - 1, 1000], [m, 1000, 1000, 1000]], trend: 0 });
    expect(r.body).toMatchObject({ liquidated: 1, fixed: true });
    expect(t.db.q("SELECT L, S FROM rates WHERE hour = ?", t.hour())).toEqual([{ L: 0, S: 200 }]);
  });

  test("two concurrent posts write one rates row and one set of ledger rows", async () => {
    const t = v3();
    const alice = await t.signIn();
    await t.mark(1000);
    await t.open(alice, { side: "long", margin: 1000, lev: 10 }, 1000);
    t.nextHour();
    const H = t.hour();
    await t.mark(1000, { trend: null }); // the hour's first post: not confirmed yet
    t.tick(5000);
    const m = t.minute();
    const bars = [[m - 60, 1000, 1000, 1000], [m, 1000, 1000, 1000]];
    const [a, b] = await Promise.all([t.markJson(1000, { bars, trend: 0.0001, ts: t.nowS() - 1 }), t.markJson(1000, { bars, trend: 0.0003 })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]); // the loser's batch aborted: a position moved under it
    expect(t.db.q("SELECT hour, trend FROM rates WHERE hour = ?", H)).toEqual([{ hour: H, trend: 0.0001 }]);
    expect(t.db.q("SELECT COUNT(*) AS n FROM house_hours WHERE hour = ?", H - 3600)).toEqual([{ n: 1 }]);
    expect(t.db.q("SELECT ref, COUNT(*) AS n FROM ledger WHERE ref LIKE 'hour:%' GROUP BY ref ORDER BY ref")).toEqual(
      t.db.q("SELECT ref, 1 AS n FROM ledger WHERE ref LIKE 'hour:%' GROUP BY ref ORDER BY ref"),
    );
    expect(t.rows(`hour:${H}`)).toHaveLength(1);
    // the producer posts again: nothing is fixed twice
    t.tick(5000);
    expect((await t.markJson(1000, { trend: 0.0009 })).body.fixed).toBe(false);
    expect(t.db.q("SELECT COUNT(*) AS n FROM rates WHERE hour = ?", H)).toEqual([{ n: 1 }]);
  });
});

describe("settlement (R3)", () => {
  test("a gap liquidation books its shortfall to insurance; a plain one books the equity left to the house", async () => {
    const t = v3();
    const alice = await t.signIn(), bob = await t.signIn(BOB);
    await t.mark(1000);
    const a = await t.open(alice, { side: "long", margin: 300, lev: 30 }, 1000);
    const b = await t.open(bob, { side: "short", margin: 1000, lev: 20 }, 1000);
    t.tick(120_000); // the crossing bar must start after both opened
    const m = t.minute();
    const bobLiq = b.body.position.liq as number;
    // Alice's bar gaps 5% below her price; Bob's bar just touches his
    const r = await t.markJson(1000, { bars: [[m - 60, bobLiq + 0.5, 950, 1000], [m, 1000, 1000, 1000]] });
    expect(r.body.liquidated).toBe(2);
    const rates = t.db.q<{ t: number; long: number; short: number }>("SELECT hour AS t, long, short FROM rates");
    const bar = [{ t: m - 60, h: bobLiq + 0.5, l: 950, c: 1000 }];
    for (const [x, gap] of [[a, true], [b, false]] as const) {
      const p = x.body.position, id = x.body.order.positionId as number;
      const pos = { side: p.side, margin: p.margin, lev: p.lev, notional: p.notional, entry: p.entry, openedAt: p.openedAt, liq: p.liq };
      const hit = Engine.liquidation(pos, bar, rates)!;
      const end = hit.t + 60, worst = p.side === "long" ? 950 : bobLiq + 0.5;
      const costs = Engine.fundingPaid(pos, rates, end) + Engine.borrowPaid(pos, end);
      const eq = p.margin + Engine.pnl(pos, worst) - costs;
      expect(hit.shortfall > 0).toBe(gap);
      const got = Object.fromEntries([...t.rows(`liq:${id}`), ...t.rows(`draw:${id}`), ...t.rows(`borrow:${id}`)].map((x) => [x.kind, x.amount]));
      if (gap) expect(got).toMatchObject({ insurance_draw: -hit.shortfall, borrow: Engine.borrowPaid(pos, end) });
      else expect(got).toMatchObject({ liq_margin: eq, borrow: Engine.borrowPaid(pos, end) });
      expect(got[gap ? "liq_margin" : "insurance_draw"]).toBeUndefined();
      expect(t.db.q("SELECT fill, returned, reason FROM positions WHERE id = ?", id)).toEqual([{ fill: worst, returned: 0, reason: "liquidation" }]);
    }
    expect((await t.economy()).insurance).toBeLessThan(0); // drawn before any split funded it
  });
});

describe("weekly split (R5)", () => {
  test("runs once for the week that ended, under concurrent requests, and splits per splitFees (points only)", async () => {
    const t = v3();
    const alice = await t.signIn();
    await t.mark(1000);
    const o = await t.open(alice, { side: "long", margin: 1000, lev: 10 }, 1000);
    t.tick(30 * 60_000);
    await t.mark(1001);
    await t.close(alice, o.body.order.positionId, 1004);
    // the first post already split the (empty) week before the pilot's first week
    const W = weekStart(t.nowS());
    expect(t.db.q("SELECT week, pool FROM splits")).toEqual([{ week: W - 7 * 86400, pool: 0 }]);
    // to Monday 00:00 UTC + 1 minute: no post yet; three public reads race
    t.tick((W + 7 * 86400 + 60 - t.nowS()) * 1000);
    const before = t.db.q<{ kind: string; balance: number }>("SELECT kind, balance FROM pools");
    const bal = Object.fromEntries(before.map((x) => [x.kind, x.balance]));
    const pool = bal.fee + bal.borrow + bal.cut + Math.max(0, bal.house_pnl + bal.liq_margin);
    expect(pool).toBeGreaterThan(0);
    await Promise.all([t.economy(), t.account(), t.call(handleFunding, t.req("/api/pilot/funding")), t.economy()]);
    const s = Engine.splitFees(pool);
    expect(t.db.q("SELECT week, pool, insurance, treasury, buyback FROM splits WHERE week = ?", W)).toEqual([{ week: W, pool, insurance: s.insurance, treasury: s.treasury, buyback: s.buyback }]);
    const split = Object.fromEntries(t.rows(`split:${W}`).map((x) => [x.kind, x.amount]));
    expect(split).toMatchObject({ split_insurance: s.insurance, split_treasury: s.treasury - s.buyback, split_buyback: s.buyback, fee: -bal.fee });
    expect(t.db.q("SELECT COUNT(*) AS n FROM ledger WHERE ref = ?", `split:${W}`)[0].n).toBe(Object.keys(split).length);
    const e = await t.economy();
    expect(e.lastSplit).toMatchObject({ week: W, pool, insurance: s.insurance, treasury: s.treasury, buyback: s.buyback });
    expect(e.treasury).toBeCloseTo(s.treasury, 9);
    expect(e.buyback).toBeCloseTo(s.buyback, 9);
    expect(e.pool.total).toBeCloseTo(0, 9); // moved out (what is left is any house loss, carried)
    expect(t.ledger()).toBeCloseTo(t.pools(), 9);
  });
});

describe("economy endpoint (R7)", () => {
  test("shape: rates now and the last 24, the house, the fee pool by source, insurance, treasury, the running week and the last split", async () => {
    const t = v3();
    const alice = await t.signIn();
    await t.mark(1000, { trend: -0.0002 });
    await t.open(alice, { side: "long", margin: 1000, lev: 5 }, 1000);
    t.nextHour();
    await t.mark(1001, { trend: -0.0002 });
    const e = await t.economy();
    expect(Object.keys(e).sort()).toEqual(["borrowApr", "house", "insurance", "lastSplit", "pool", "rates", "treasury", "buyback", "ts", "week"].sort());
    expect(e.rates.current).toMatchObject({ t: t.hour(), L: 5000, S: 0, skew: 1, houseExposure: -5000 });
    expect(e.rates.recent.map((r) => r.t)).toEqual([t.hour(), t.hour() - 3600]);
    expect(e.house.exposure).toBe(-5000);
    expect(Object.keys(e.house).sort()).toEqual(["exposure", "pnl24h", "pnlAll", "pnlWeek"]);
    expect(Object.keys(e.pool).sort()).toEqual(["borrow", "cut", "fee", "house", "total"]);
    expect(e.pool.fee).toBeCloseTo(5000 * Engine.RULES.feeRate, 12);
    expect(e.pool.cut).toBeCloseTo(e.rates.current!.cut, 12);
    expect(e.week).toMatchObject({ start: weekStart(t.nowS()) });
    expect(e.week.insurance).toBeCloseTo(e.week.pool * 0.2, 9);
    expect(e.borrowApr).toBe(0.1);
    expect(e.lastSplit).toMatchObject({ pool: 0 });
    const res = await handleEconomy(t.req("/api/pilot/economy", "POST"), t.env, t.deps);
    expect(res.status).toBe(405);
  });
});

describe("conservation (R4)", () => {
  test("a scripted multi-hour scenario: opens, hourly closes, closes, a gap liquidation, a split; Σ balance changes + Σ ledger = 0", async () => {
    const t = v3();
    const alice = await t.signIn(), bob = await t.signIn(BOB), carol = await t.signIn(CAROL);
    await t.mark(1000, { trend: -0.0002 }); // Saturday 12:00 UTC
    const a = await t.open(alice, { side: "long", margin: 1000, lev: 10 }, 1000);
    const b = await t.open(bob, { side: "short", margin: 500, lev: 20 }, 1001);
    const c = await t.open(carol, { side: "long", margin: 300, lev: 30 }, 1002);
    t.tick(20 * 60_000);
    await t.mark(1003);
    t.nextHour(5);
    await t.mark(1004, { trend: -0.0001 }); // fixes the hour from the book; books the hour before
    // Carol's 30× long gaps through: a finished bar 5% down
    t.tick(60_000);
    const m = t.minute();
    expect((await t.markJson(1000, { bars: [[m - 60, 1004, 950, 1000], [m, 1000, 1000, 1000]] })).body.liquidated).toBe(1);
    expect(t.rows(`draw:${c.body.order.positionId}`)[0].amount).toBeLessThan(0);
    t.tick(10 * 60_000);
    await t.mark(1006);
    const ca = await t.close(alice, a.body.order.positionId, 1010);
    expect(ca.body.order?.status, JSON.stringify(ca.body)).toBe("filled");
    // another hour mid-way, then Monday 00:00 UTC: one post fixes the hour, books the hours since, splits the week
    t.nextHour(30);
    await t.mark(1005, { trend: 0.0001 });
    const W = weekStart(t.nowS()) + 7 * 86400;
    t.tick((W + 20 - t.nowS()) * 1000);
    const mon = await t.markJson(1002, { trend: 0.0002 });
    expect(mon.status, JSON.stringify(mon.body)).toBe(200);
    expect(t.db.q("SELECT COUNT(*) AS n FROM splits WHERE week = ?", W - 7 * 86400)[0]).toEqual({ n: 1 });
    expect(t.db.q<{ pool: number }>("SELECT pool FROM splits WHERE week = ?", W - 7 * 86400)[0].pool).toBeGreaterThan(0);
    const bob2 = await t.signIn(BOB); // sessions last 12 h
    const cb = await t.close(bob2, b.body.order.positionId, 1001);
    expect(cb.body.order?.status, JSON.stringify(cb.body)).toBe("filled");
    // every position is settled; the next hour's close books the last hour (its cut and the house's true-up)
    t.nextHour(1);
    await t.mark(1001, { trend: 0 });
    expect(t.db.q("SELECT COUNT(*) AS n FROM positions WHERE closed_at IS NULL")[0]).toEqual({ n: 0 });
    expect(t.db.q<{ cut: number }>("SELECT cut FROM rates WHERE hour = ?", t.hour())[0].cut).toBe(0); // an empty book
    expect(Math.abs(t.traders())).toBeGreaterThan(1); // points really moved
    expect(t.traders() + t.ledger()).toBeCloseTo(0, 6);
    expect(t.pools()).toBeCloseTo(t.ledger(), 6);
    // and the house was the counterparty: its result is what the traders lost on price and paid in funding, net of the cut
    const e = await t.economy();
    expect(e.house.pnlAll).toBeCloseTo(t.db.q<{ s: number }>("SELECT SUM(amount) AS s FROM ledger WHERE kind IN ('house_pnl', 'liq_margin') AND ref NOT LIKE 'split:%'")[0].s, 6);
    const sumHours = t.db.q<{ s: number }>("SELECT SUM(total) AS s FROM house_hours")[0].s;
    expect(e.house.pnlAll).toBeCloseTo(sumHours + t.db.q<{ s: number }>("SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE kind IN ('house_pnl', 'liq_margin') AND ref NOT LIKE 'split:%' AND ts >= ?", t.hour())[0].s, 6);
  });

  test("account poll after the scenario start still reads no more than the mark row join (split already done)", async () => {
    const t = v3();
    await t.mark(1000);
    const before = t.db.log.length;
    await handleAccount(t.req("/api/pilot/account"), t.env, t.deps);
    expect(t.db.log.slice(before).filter((x) => /splits/.test(x) && !/FROM mark m/.test(x))).toEqual([]);
  });
});
