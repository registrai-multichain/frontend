import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import * as Port from "../../src/lib/abi-pilot";

/**
 * R2 parity, economy v2: src/lib/abi-pilot.ts must give exactly the reference engine's results. The reference
 * (research/arc-builders-index/pilot/pilot.js and pilot.test.js, outside this repo) is vendored at
 * test/reference/pilot.cjs and pilot.test.cjs; the first tests check both copies are unchanged when the
 * research tree is next to this checkout. Its node:test cases are transcribed below and run on both engines.
 */
type Api = typeof Port;
const REF = createRequire(import.meta.url)("./reference/pilot.cjs") as Api;

describe("the vendored reference", () => {
  const dir = ["../../research", "../../../research"].map((p) => resolve(__dirname, "..", p, "arc-builders-index/pilot")).find((d) => existsSync(`${d}/pilot.js`));
  test.skipIf(!dir)("pilot.cjs matches research/arc-builders-index/pilot/pilot.js", () => {
    expect(readFileSync(resolve(__dirname, "reference/pilot.cjs"), "utf8")).toBe(readFileSync(`${dir}/pilot.js`, "utf8"));
  });
  test.skipIf(!dir)("pilot.test.cjs matches pilot.test.js (only the require path differs)", () => {
    const ours = readFileSync(resolve(__dirname, "reference/pilot.test.cjs"), "utf8");
    expect(ours.replace('require("./pilot.cjs")', 'require("./pilot.js")')).toBe(readFileSync(`${dir}/pilot.test.js`, "utf8"));
  });
  test("RULES are identical", () => {
    expect(Port.RULES).toEqual(REF.RULES);
  });
});

// pilot.test.js (v2), run against both engines
describe.each([["reference", REF], ["port", Port as Api]])("pilot.test.js cases (%s)", (_n, P) => {
  const R = P.RULES;
  const acct = (balance = 10000) => ({ balance, open: 0 });
  const calm = { sigma24: 0.002, sigma1h: 0.0004, ch1: 0 };
  const near = (a: number, b: number, e = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(e);
  const opened = (r: Port.OpenResult) => { if (!r.ok) throw new Error(r.error); return r; };

  test("risk: funding = mean hourly return over the funding window, sigma over 24 h scaled by √24", () => {
    const closes = [1000]; for (let i = 0; i < 30; i++) closes.push(closes[closes.length - 1] * (i % 2 ? 0.999 : 1.0005));
    const rk = P.risk(closes);
    const r6 = P.returns(closes).slice(-R.window);
    near(rk.funding, r6.reduce((a, b) => a + b) / r6.length);
    near(rk.sigma24, rk.sigma1h * Math.sqrt(24));
  });

  test("dynamic leverage from volatility, snapped to allowed levels, and the pause", () => {
    expect(P.maxLeverage({ sigma24: 0.002, sigma1h: 0.0004, ch1: 0 }).max).toBe(20);
    expect(P.maxLeverage({ sigma24: 0.012, sigma1h: 0.002, ch1: 0 }).max).toBe(5);
    expect(P.maxLeverage({ sigma24: 0.04, sigma1h: 0.008, ch1: 0 }).max).toBe(2);
    expect(P.maxLeverage({ sigma24: 0.5, sigma1h: 0.1, ch1: 0 }).max).toBe(1);
    expect(P.maxLeverage({ sigma24: 0, sigma1h: 0, ch1: 0 }).max).toBe(20);
    expect(P.maxLeverage({ sigma24: 0.002, sigma1h: 0.0004, ch1: 0.006 }).paused).toBe(true);
    expect(P.maxLeverage({ sigma24: 0.002, sigma1h: 0.0004, ch1: 0.004 }).paused).toBe(false);
    expect(P.maxLeverage({ sigma24: 0.05, sigma1h: 0.002, ch1: 0.009 }).paused).toBe(false);
  });

  test("open: fee, notional, liquidation price at 20x", () => {
    const r = opened(P.open(acct(), { side: "long", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm }));
    expect(r.position.notional).toBe(20000);
    near(r.fee, 20000 * R.feeRate);
    near(r.balance, 10000 - 1000 - r.fee);
    near(r.position.liq, 1000 * (1 - (1 / 20 - R.mm)));
  });

  test("open: refusals", () => {
    const base = { side: "long", margin: 1000, lev: 2, mark: 1000, now: 1, risk: calm };
    expect(P.open(acct(500), base).error).toBe("insufficient balance");
    expect(P.open(acct(), { ...base, margin: 5 }).error).toBe("margin below minimum");
    expect(P.open(acct(), { ...base, lev: 4 }).error).toBe("leverage not allowed");
    expect(P.open(acct(), { ...base, lev: 20, risk: { sigma24: 0.04, sigma1h: 0.008, ch1: 0 } }).error).toBe("leverage above the current cap");
    expect(P.open(acct(), { ...base, risk: { ...calm, ch1: 0.01 } }).error).toBe("trading paused");
    expect(P.open({ balance: 10000, open: 5 }, base).error).toBe("too many open positions");
  });

  test("funding: longs receive when the trend is down, pro rata to time held", () => {
    const { position: L } = opened(P.open(acct(), { side: "long", margin: 1000, lev: 10, mark: 1000, now: 1800, risk: calm }));
    const { position: S } = opened(P.open(acct(), { side: "short", margin: 1000, lev: 10, mark: 1000, now: 1800, risk: calm }));
    const rates = [{ t: 0, rate: -0.0004 }, { t: 3600, rate: -0.0004 }];
    near(P.fundingAccrued(L, rates, 7200), 0.0004 * 10000 * 1.5);
    near(P.fundingAccrued(S, rates, 7200), -0.0004 * 10000 * 1.5);
    near(P.fundingAccrued(L, rates, 1800), 0);
  });

  test("funding cancels a steady trend: long and short both break even before fees", () => {
    const closes = [1000]; for (let i = 0; i < 24; i++) closes.push(closes[i] * (1 - 0.0004));
    const rates = Array.from({ length: 24 }, (_, i) => ({ t: i * 3600, rate: -0.0004 }));
    for (const side of ["long", "short"]) {
      const { position } = opened(P.open(acct(), { side, margin: 1000, lev: 5, mark: 1000, now: 0, risk: calm }));
      const c = P.close(position, closes[24], 24 * 3600, rates);
      near(c.pnl + c.funding, 0, 0.6);
    }
  });

  test("close: payout never negative, funding and fee included", () => {
    const { position } = opened(P.open(acct(), { side: "long", margin: 100, lev: 20, mark: 1000, now: 0, risk: calm }));
    expect(P.close(position, 900, 3600, []).payout).toBe(0);
    const { position: p2 } = opened(P.open(acct(), { side: "short", margin: 1000, lev: 2, mark: 1000, now: 0, risk: calm }));
    const c = P.close(p2, 990, 3600, [{ t: 0, rate: 0.001 }]);
    near(c.pnl, 20); near(c.funding, 2); near(c.fee, 1980 * R.feeRate);
    near(c.payout, 1000 + 20 + 2 - 1980 * R.feeRate);
  });

  test("liquidation uses bars after the open and moves with funding", () => {
    const { position } = opened(P.open(acct(), { side: "long", margin: 1000, lev: 20, mark: 1000, now: 600, risk: calm }));
    const bars = [{ t: 540, h: 1000, l: 900, c: 1000 }, { t: 600, h: 1001, l: 999, c: 1000 }, { t: 660, h: 1000, l: 954, c: 960 }];
    const hit = P.liquidation(position, bars, []);
    expect(hit?.t).toBe(660); near(hit!.price, 955);
    const { position: s } = opened(P.open(acct(), { side: "short", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm }));
    const rates = [{ t: 0, rate: 0.002 }];
    expect(P.liqPrice(s, P.fundingAccrued(s, rates, 3600))).toBeGreaterThan(P.liqPrice(s, 0));
    const { position: l2 } = opened(P.open(acct(), { side: "long", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm }));
    expect(P.liqPrice(l2, P.fundingAccrued(l2, rates, 3600))).toBeGreaterThan(P.liqPrice(l2, 0));
    expect(P.liquidation(position, bars.slice(0, 2), [])).toBeNull();
  });

  test("a hedged pair cannot mint points", () => {
    const rates = [{ t: 0, rate: -0.0005 }, { t: 3600, rate: 0.0003 }];
    const { position: L } = opened(P.open(acct(), { side: "long", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm }));
    const { position: S } = opened(P.open(acct(), { side: "short", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm }));
    for (const px of [990, 1000, 1010]) {
      const a = P.close(L, px, 7200, rates), b = P.close(S, px, 7200, rates);
      expect(a.payout + b.payout).toBeLessThan(2000);
    }
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

  test("returns, risk, maxLeverage, open, pnl, liqPrice, fundingAccrued, close, liquidation, equity: 10000 cases", () => {
    let opens = 0, liqs = 0;
    for (let i = 0; i < 10000; i++) {
      const closes = Array.from({ length: Math.floor(rnd() * 32) }, () => 900 + rnd() * 200);
      expect(Port.returns(closes)).toEqual(REF.returns(closes));
      expect(Port.risk(closes)).toEqual(REF.risk(closes));
      const rk = {
        sigma24: pick([0, null, undefined, NaN, rnd() * 0.2, 0.005, 0.1, 0.0125]),
        sigma1h: pick([0, null, undefined, rnd() * 0.01, 0.001]),
        ch1: pick([0, null, undefined, (rnd() - 0.5) * 0.03, 0.005, -0.005]),
      };
      expect(Port.maxLeverage(rk)).toEqual(REF.maxLeverage(rk));
      const side = pick(["long", "short", "long", "short", "up", ""]);
      const lev = pick([1, 2, 3, 5, 10, 20, 4, 0, 2.5]);
      const mark = pick([800 + rnd() * 400, 0, -1, NaN, 1000]);
      const margin = pick([rnd() * 12000, rnd() * 3000, 10, 9.99, NaN, 1000]);
      const account = { balance: pick([10000, rnd() * 10000, 0]), open: Math.floor(rnd() * 7) };
      const now = Math.floor(rnd() * 1e6);
      const input = { side, margin, lev, mark, now, risk: pick([rk, undefined, { sigma24: 0.002, sigma1h: 0.0004, ch1: 0 }, { sigma24: 0.002, sigma1h: 0.0004, ch1: 0 }]) };
      const a = Port.open(account, input), b = REF.open(account, input);
      expect(a).toEqual(b);
      if (!a.ok) continue;
      opens++;
      const pos = a.position;
      const h0 = Math.floor(now / 3600) * 3600;
      const rates = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, k) => ({ t: h0 - 3600 + k * 3600, rate: (rnd() - 0.5) * 0.004 }));
      const at = 800 + rnd() * 400, to = now + Math.floor(rnd() * 5 * 3600);
      expect(Port.pnl(pos, at)).toBe(REF.pnl(pos, at));
      expect(Port.fundingAccrued(pos, rates, to)).toBe(REF.fundingAccrued(pos, rates, to));
      const f = (rnd() - 0.5) * pos.margin;
      expect(Port.liqPrice(pos, f)).toBe(REF.liqPrice(pos, f));
      expect(Port.liqPrice(pos)).toBe(REF.liqPrice(pos));
      expect(Port.close(pos, at, to, rates)).toEqual(REF.close(pos, at, to, rates));
      expect(Port.close(pos, at, to)).toEqual(REF.close(pos, at, to));
      expect(Port.equity(a.balance, [pos, pos], at, to, rates)).toBe(REF.equity(a.balance, [pos, pos], at, to, rates));
      const bars = Array.from({ length: 8 }, (_, k) => {
        const c = pos.entry * (0.9 + rnd() * 0.2);
        return { t: Math.floor(now / 60) * 60 - 120 + k * 60, h: c * (1 + rnd() * 0.06), l: c * (1 - rnd() * 0.08), c };
      });
      const hit = Port.liquidation(pos, bars, rates);
      if (hit) liqs++;
      expect(hit).toEqual(REF.liquidation(pos, bars, rates));
      expect(Port.liquidation(pos, bars)).toEqual(REF.liquidation(pos, bars));
    }
    expect(opens).toBeGreaterThan(300); // the comparisons past open() really ran
    expect(liqs).toBeGreaterThan(30);
  });
});
