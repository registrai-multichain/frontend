import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import * as Port from "../../src/lib/abi-pilot";

/**
 * R1 parity, economy v3: src/lib/abi-pilot.ts must give exactly the reference engine's results. The reference
 * (research/arc-builders-index/pilot/pilot.js, pilot.test.js and fixtures-v3.json, outside this repo) is vendored
 * at test/reference/ (pilot.cjs, pilot.test.cjs, fixtures-v3.json minified); the first tests check the copies are
 * unchanged when the research tree is next to this checkout. Every fixture vector runs against the port (and the
 * reference) at full double precision; the node:test cases are transcribed below and run on both engines.
 */
type Api = typeof Port;
const REF = createRequire(import.meta.url)("./reference/pilot.cjs") as Api;
interface Fixtures {
  rules: unknown;
  cases: Record<string, { input: Record<string, unknown>; output: unknown }[]>;
}
const FIX = JSON.parse(readFileSync(resolve(__dirname, "reference/fixtures-v3.json"), "utf8")) as Fixtures;

describe("the vendored reference", () => {
  const dir = ["../../research", "../../../research", "../../../../research"].map((p) => resolve(__dirname, "..", p, "arc-builders-index/pilot")).find((d) => existsSync(`${d}/pilot.js`));
  test.skipIf(!dir)("pilot.cjs matches research/arc-builders-index/pilot/pilot.js", () => {
    expect(readFileSync(resolve(__dirname, "reference/pilot.cjs"), "utf8")).toBe(readFileSync(`${dir}/pilot.js`, "utf8"));
  });
  test.skipIf(!dir)("pilot.test.cjs matches pilot.test.js (only the require path differs)", () => {
    const ours = readFileSync(resolve(__dirname, "reference/pilot.test.cjs"), "utf8");
    expect(ours.replace('require("./pilot.cjs")', 'require("./pilot.js")')).toBe(readFileSync(`${dir}/pilot.test.js`, "utf8"));
  });
  test.skipIf(!dir || !existsSync(`${dir}/fixtures-v3.json`))("fixtures-v3.json matches the research vectors", () => {
    expect(FIX).toEqual(JSON.parse(readFileSync(`${dir}/fixtures-v3.json`, "utf8")));
  });
  test("RULES are identical (port, reference, fixtures)", () => {
    expect(Port.RULES).toEqual(REF.RULES);
    expect(Port.RULES).toEqual(FIX.rules);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const CALLS: Record<string, (P: Api, i: any) => unknown> = {
  fundingRates: (P, i) => P.fundingRates(i),
  fundingPaid: (P, i) => P.fundingPaid(i.pos, i.rates, i.to),
  borrowPaid: (P, i) => P.borrowPaid(i.pos, i.to),
  liqPrice: (P, i) => P.liqPrice(i.pos, i.costs),
  close: (P, i) => P.close(i.pos, i.mark, i.now, i.rates),
  liquidation: (P, i) => P.liquidation(i.pos, i.bars, i.rates),
  equity: (P, i) => P.equity(i.balance, i.positions, i.mark, i.now, i.rates),
  open: (P, i) => P.open(i.account, i.args),
  maxLeverage: (P, i) => P.maxLeverage(i),
  risk: (P, i) => P.risk(i.closes, i.steps),
  houseHour: (P, i) => P.houseHour(i),
  bookTW: (P, i) => P.bookTW(i.positions, i.from, i.to),
  splitFees: (P, i) => P.splitFees(i.pool),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const asJson = (x: unknown) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

describe("fixtures-v3.json: every vector, exact", () => {
  test("every case function is covered", () => {
    expect(Object.keys(FIX.cases).sort()).toEqual(Object.keys(CALLS).sort());
  });
  describe.each(Object.keys(CALLS))("%s", (fn) => {
    test.each([["port", Port as Api], ["reference", REF]])("%s", (_n, P) => {
      const cases = FIX.cases[fn];
      expect(cases.length).toBeGreaterThan(0);
      // through JSON like the vectors themselves: doubles round-trip exactly; only −0 becomes 0 (JSON has no −0)
      for (const c of cases) expect(asJson(CALLS[fn](P, structuredClone(c.input)))).toEqual(c.output);
    });
  });
});

// pilot.test.js (v3), run against both engines
describe.each([["reference", REF], ["port", Port as Api]])("pilot.test.js cases (%s)", (_n, P) => {
  const acct = (balance = 10000) => ({ balance, open: 0 });
  const calm = { sigma24: 0.0005, sigma1h: 0.0001, ch1: 0 };
  const near = (a: number, b: number, e = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(e);
  const opened = (r: Port.OpenResult) => { if (!r.ok) throw new Error(r.error); return r; };

  test("risk: trend over 6 h with milestone steps divided out; σ over 24 h", () => {
    const closes = [1000]; for (let i = 0; i < 30; i++) closes.push(closes[i] * (1 - 0.0002));
    near(P.risk(closes).trend!, -0.0002, 1e-12);
    const jumped = closes.slice(); for (let i = 28; i < jumped.length; i++) jumped[i] *= 1.025;
    near(P.risk(jumped, { 28: 1.025 }).trend!, -0.0002, 1e-12);
    expect(P.risk(jumped).trend!).toBeGreaterThan(0.003);
    expect(P.risk([1000])).toEqual({ trend: null, funding: null, sigma1h: null, sigma24: null });
  });

  test("leverage: jump cap 30× even when volatility allows more", () => {
    expect(P.maxLeverage({ sigma24: 0.0005, sigma1h: 0.0001, ch1: 0 }).max).toBe(30);
    expect(P.maxLeverage({ sigma24: 0.012, sigma1h: 0.002, ch1: 0 }).max).toBe(5);
    expect(P.open(acct(), { side: "long", margin: 100, lev: 50, mark: 1000, now: 0, risk: calm }).error).toBe("leverage not allowed");
    const { position } = opened(P.open(acct(), { side: "short", margin: 1000, lev: 30, mark: 1000, now: 0, risk: calm }));
    expect(P.pnl(position, 1025)).toBeGreaterThan(-position.margin);
  });

  test("funding: trend term on everyone, skew term heavy pays |r|, light (incl. house) receives 90%", () => {
    const fr = P.fundingRates({ L: 70000, S: 30000, trend: -0.0002, sigma1h: 0.0001 });
    near(fr.skew, 0.4); near(fr.rMax, 0.00015); near(fr.r, 0.00006);
    expect(fr.heavy).toBe("long");
    near(fr.long, -0.0002 + 0.00006);
    near(fr.short, 0.0002 - 0.9 * 0.00006);
    near(fr.houseExposure, -40000);
    near(fr.cut, 0.1 * 0.00006 * 70000);
  });

  test("conservation: traders' funding + the house's receipts = 0", () => {
    for (const [L, S, tr] of [[70000, 30000, -0.0002], [10000, 90000, 0.0003], [0, 50000, -0.0001], [5e5, 5e5, 0.0001]]) {
      const fr = P.fundingRates({ L, S, trend: tr, sigma1h: 0.0001 });
      near(fr.long * L + fr.short * S - fr.houseFunding, 0, 1e-9);
    }
  });

  test("the house is drift-neutral: trend receipts offset the drift on its exposure", () => {
    const tr = -0.00028, L = 200000, S = 900000;
    const h = P.houseHour({ L, S, open: 1000, close: 1000 * (1 + tr), trend: tr, sigma1h: 0.00005 });
    near(h.pricePnl + P.fundingRates({ L, S, trend: tr, sigma1h: 0.00005 }).houseTrend, 0, 1e-6);
    expect(h.total).toBeGreaterThan(0);
  });

  test("light side empty: heavy pays, the house (whole light side) and the cut take it", () => {
    const fr = P.fundingRates({ L: 0, S: 50000, trend: 0, sigma1h: 0.0001 });
    expect(fr.heavy).toBe("short");
    near(fr.houseFunding, fr.paid);
  });

  test("funding and borrow accrue pro rata and move the liquidation price", () => {
    const { position: L } = opened(P.open(acct(), { side: "long", margin: 1000, lev: 10, mark: 1000, now: 1800, risk: calm }));
    const rates = [{ t: 0, long: 0.0002, short: -0.00018 }, { t: 3600, long: 0.0002, short: -0.00018 }];
    near(P.fundingPaid(L, rates, 7200), 0.0002 * 10000 * 1.5);
    near(P.fundingAccrued(L, rates, 7200), -3);
    expect(P.liqPrice(L, P.fundingPaid(L, rates, 7200) + P.borrowPaid(L, 7200))).toBeGreaterThan(P.liqPrice(L, 0));
    near(P.fundingPaid(L, [{ t: 0, rate: 0.0001 }], 3600), 0.0001 * 10000 * 0.5);
  });

  test("close: payout = margin + PnL − funding − borrow − fee, never below 0", () => {
    const { position } = opened(P.open(acct(), { side: "short", margin: 1000, lev: 10, mark: 1000, now: 0, risk: calm }));
    const c = P.close(position, 990, 3600, [{ t: 0, long: 0.0003, short: -0.0002 }]);
    near(c.pnl, 100); near(c.funding, 2); near(c.borrow, 9000 * 0.1 / 8760);
    near(c.payout, 1000 + 100 + 2 - c.borrow - c.fee);
    const { position: p2 } = opened(P.open(acct(), { side: "long", margin: 100, lev: 30, mark: 1000, now: 0, risk: calm }));
    expect(P.close(p2, 900, 3600, []).payout).toBe(0);
  });

  test("liquidation reports a gap shortfall for the insurance pool", () => {
    const { position } = opened(P.open(acct(), { side: "short", margin: 1000, lev: 30, mark: 1000, now: 0, risk: calm }));
    expect(P.liquidation(position, [{ t: 60, h: 1040, l: 1000, c: 1040 }], [])!.shortfall).toBeGreaterThan(0);
    expect(P.liquidation(position, [{ t: 60, h: 1030, l: 1000, c: 1030 }], [])!.shortfall).toBe(0);
    expect(P.liquidation(position, [{ t: 60, h: 1010, l: 1000, c: 1010 }], [])).toBeNull();
  });

  test("one direction per wallet; a hedged pair across two wallets loses the cut + borrow", () => {
    expect(P.open({ balance: 1e4, open: 1, side: "long" }, { side: "short", margin: 100, lev: 2, mark: 1000, now: 0, risk: calm }).error).toBe("one direction at a time");
    const fr = P.fundingRates({ L: 80000, S: 20000, trend: 0, sigma1h: 0.0002 });
    const rates = [{ t: 0, long: fr.long, short: fr.short }];
    const { position: a } = opened(P.open(acct(), { side: "long", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm }));
    const { position: b } = opened(P.open(acct(), { side: "short", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm }));
    for (const px of [995, 1000, 1005]) expect(P.close(a, px, 3600, rates).payout + P.close(b, px, 3600, rates).payout).toBeLessThan(2000);
  });

  test("time-weighted book: a position closed 1 min before the close still counts for its 59 minutes", () => {
    const h = 1791600000, pos = [
      { side: "long", notional: 60000, openedAt: h - 7200 },
      { side: "short", notional: 36000, openedAt: h, closedAt: h + 3540 },
      { side: "short", notional: 36000, openedAt: h + 3660 },
      { side: "long", notional: 7200, openedAt: h + 1800, closedAt: h + 2700 },
    ];
    const b = P.bookTW(pos, h, h + 3600);
    near(b.L, 60000 + 1800); near(b.S, 35400);
    expect(P.bookTW(pos, h + 7200, h + 10800)).toEqual({ L: 60000, S: 36000 });
  });

  test("fee split", () => {
    const s = P.splitFees(1000);
    near(s.insurance, 200); near(s.treasury, 800); near(s.buyback, 400);
  });
});

describe("port = reference on random inputs (exact)", () => {
  let s = 0x5eed;
  const rnd = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

  test("every exported function: 10000 cases", () => {
    let opens = 0, liqs = 0;
    for (let i = 0; i < 10000; i++) {
      const closes = Array.from({ length: Math.floor(rnd() * 32) }, () => 900 + rnd() * 200);
      const steps = rnd() < 0.3 && closes.length > 2 ? { [1 + Math.floor(rnd() * (closes.length - 1))]: 1 + (rnd() - 0.5) * 0.05 } : {};
      expect(Port.returns(closes, steps)).toEqual(REF.returns(closes, steps));
      expect(Port.risk(closes, steps)).toEqual(REF.risk(closes, steps));
      const rk = {
        sigma24: pick([0, null, undefined, NaN, rnd() * 0.2, 0.005, 0.1, 0.0125, 0.0005]),
        sigma1h: pick([0, null, undefined, rnd() * 0.01, 0.001]),
        ch1: pick([0, null, undefined, (rnd() - 0.5) * 0.03, 0.005, -0.005]),
      };
      expect(Port.maxLeverage(rk)).toEqual(REF.maxLeverage(rk));
      const book = { L: pick([0, Math.round(rnd() * 2e6), 50000]), S: pick([0, Math.round(rnd() * 2e6), 50000]), trend: pick([0, null, undefined, (rnd() - 0.5) * 0.001]), sigma1h: pick([0, null, undefined, rnd() * 0.0005]) };
      expect(Port.fundingRates(book)).toEqual(REF.fundingRates(book));
      const hh = { ...book, open: 900 + rnd() * 200, close: 900 + rnd() * 200 };
      expect(Port.houseHour(hh)).toEqual(REF.houseHour(hh));
      const pool = rnd() * 1e6;
      expect(Port.splitFees(pool)).toEqual(REF.splitFees(pool));
      const tw = Array.from({ length: Math.floor(rnd() * 6) }, () => ({ side: pick(["long", "short"]), notional: rnd() * 1e5, openedAt: Math.floor(rnd() * 7200), closedAt: pick([undefined, null, Math.floor(rnd() * 9000)]) }));
      expect(Port.bookTW(tw, 3600, 7200)).toEqual(REF.bookTW(tw, 3600, 7200));
      const side = pick(["long", "short", "long", "short", "up", ""]);
      const lev = pick([1, 2, 3, 5, 10, 20, 30, 4, 0, 2.5, 50]);
      const mark = pick([800 + rnd() * 400, 0, -1, NaN, 1000]);
      const margin = pick([rnd() * 12000, rnd() * 3000, 10, 9.99, NaN, 1000]);
      const account = { balance: pick([10000, rnd() * 10000, 0]), open: Math.floor(rnd() * 7), side: pick(["long", "short", undefined, null]) };
      const now = Math.floor(rnd() * 1e6);
      const input = { side, margin, lev, mark, now, risk: pick([rk, undefined, { sigma24: 0.0005, sigma1h: 0.0001, ch1: 0 }, { sigma24: 0.0005, sigma1h: 0.0001, ch1: 0 }]) };
      const a = Port.open(account, input), b = REF.open(account, input);
      expect(a).toEqual(b);
      if (!a.ok) continue;
      opens++;
      const pos = a.position;
      const h0 = Math.floor(now / 3600) * 3600;
      const rates = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, k) => (rnd() < 0.15
        ? { t: h0 - 3600 + k * 3600, rate: (rnd() - 0.5) * 0.004 }
        : { t: h0 - 3600 + k * 3600, long: (rnd() - 0.5) * 0.004, short: (rnd() - 0.5) * 0.004 }));
      const at = 800 + rnd() * 400, to = now + Math.floor(rnd() * 5 * 3600);
      expect(Port.pnl(pos, at)).toBe(REF.pnl(pos, at));
      expect(Port.fundingPaid(pos, rates, to)).toBe(REF.fundingPaid(pos, rates, to));
      expect(Port.fundingAccrued(pos, rates, to)).toBe(REF.fundingAccrued(pos, rates, to));
      expect(Port.borrowPaid(pos, to)).toBe(REF.borrowPaid(pos, to));
      const c = rnd() * pos.margin;
      expect(Port.liqPrice(pos, c)).toBe(REF.liqPrice(pos, c));
      expect(Port.liqPrice(pos)).toBe(REF.liqPrice(pos));
      expect(Port.close(pos, at, to, rates)).toEqual(REF.close(pos, at, to, rates));
      expect(Port.close(pos, at, to)).toEqual(REF.close(pos, at, to));
      expect(Port.equity(a.balance, [pos, pos], at, to, rates)).toBe(REF.equity(a.balance, [pos, pos], at, to, rates));
      const bars = Array.from({ length: 8 }, (_, k) => {
        const cl = pos.entry * (0.9 + rnd() * 0.2);
        return { t: Math.floor(now / 60) * 60 - 120 + k * 60, h: cl * (1 + rnd() * 0.06), l: cl * (1 - rnd() * 0.08), c: cl };
      });
      const hit = Port.liquidation(pos, bars, rates);
      if (hit) liqs++;
      expect(hit).toEqual(REF.liquidation(pos, bars, rates));
      expect(Port.liquidation(pos, bars)).toEqual(REF.liquidation(pos, bars));
    }
    expect(opens).toBeGreaterThan(300);
    expect(liqs).toBeGreaterThan(30);
  });
});
