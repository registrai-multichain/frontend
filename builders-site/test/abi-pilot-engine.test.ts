import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import * as Port from "../../src/lib/abi-pilot";

/**
 * R2: src/lib/abi-pilot.ts must give exactly the reference engine's results. The reference
 * (research/arc-builders-index/pilot/pilot.js, outside this repo) is vendored at
 * test/reference/pilot.cjs; the first test checks the copy is still byte-identical when the
 * research tree is next to this checkout.
 */
type Api = typeof Port;
const REF = createRequire(import.meta.url)("./reference/pilot.cjs") as Api;

describe("the vendored reference", () => {
  const candidates = ["../../research", "../../../research"].map((p) => resolve(__dirname, "..", p, "arc-builders-index/pilot/pilot.js"));
  const original = candidates.find(existsSync);
  test.skipIf(!original)("matches research/arc-builders-index/pilot/pilot.js", () => {
    expect(readFileSync(resolve(__dirname, "reference/pilot.cjs"), "utf8")).toBe(readFileSync(original!, "utf8"));
  });
  test("RULES are identical", () => {
    expect(Port.RULES).toEqual(REF.RULES);
  });
});

// pilot.test.js, run against both engines
describe.each([["reference", REF], ["port", Port as Api]])("pilot.test.js cases (%s)", (_n, P) => {
  const R = P.RULES;
  const acct = (balance = 10000) => ({ balance, open: 0 });

  test("dynamic leverage cap and pause", () => {
    expect(P.maxLeverage({ ch24: -0.0056, ch1: -0.0001 })).toEqual({ max: 3, paused: false });
    expect(P.maxLeverage({ ch24: 0.12, ch1: 0 })).toEqual({ max: 2, paused: false });
    expect(P.maxLeverage({ ch24: -0.30, ch1: 0 })).toEqual({ max: 1, paused: false });
    expect(P.maxLeverage({ ch24: 0, ch1: -0.05 }).paused).toBe(true);
  });

  test("open: fee, notional, liquidation price", () => {
    const r = P.open(acct(), { side: "long", margin: 1000, lev: 2, mark: 982.2, now: 100, ch24: -0.005, ch1: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.position.notional).toBe(2000);
    expect(r.fee).toBe(2000 * R.feeRate);
    expect(r.balance).toBe(10000 - 1000 - r.fee);
    expect(Math.abs(r.position.liq - 982.2 * (1 - (1 / 2 - R.mm)))).toBeLessThan(1e-9);
    const s = P.open(acct(), { side: "short", margin: 1000, lev: 3, mark: 1000, now: 100, ch24: 0, ch1: 0 });
    expect(s.ok && Math.abs(s.position.liq - 1000 * (1 + (1 / 3 - R.mm)))).toBeLessThan(1e-9);
  });

  test("open: refusals", () => {
    const base = { side: "long", margin: 1000, lev: 2, mark: 1000, now: 1, ch24: 0, ch1: 0 };
    expect(P.open(acct(500), base).error).toBe("insufficient balance");
    expect(P.open(acct(), { ...base, margin: 5 }).error).toBe("margin below minimum");
    expect(P.open(acct(), { ...base, lev: 4 }).error).toBe("leverage not allowed");
    expect(P.open(acct(), { ...base, lev: 3, ch24: 0.3 }).error).toBe("leverage above the current cap");
    expect(P.open(acct(), { ...base, ch1: 0.05 }).error).toBe("trading paused");
    expect(P.open({ balance: 10000, open: 5 }, base).error).toBe("too many open positions");
    expect(P.open(acct(), { ...base, side: "up" }).error).toBe("bad side");
  });

  test("pnl and close", () => {
    const o = P.open(acct(), { side: "long", margin: 1000, lev: 3, mark: 1000, now: 1, ch24: 0, ch1: 0 });
    if (!o.ok) throw new Error(o.error);
    expect(Math.abs(P.pnl(o.position, 1010) - 30)).toBeLessThan(1e-9);
    const c = P.close(o.position, 1010);
    expect(Math.abs(c.pnl - 30)).toBeLessThan(1e-9);
    expect(Math.abs(c.payout - (1000 + 30 - 3030 * R.feeRate))).toBeLessThan(1e-9);
    const sh = P.open(acct(), { side: "short", margin: 1000, lev: 2, mark: 1000, now: 1, ch24: 0, ch1: 0 });
    if (!sh.ok) throw new Error(sh.error);
    expect(Math.abs(P.pnl(sh.position, 990) - 20)).toBeLessThan(1e-9);
  });

  test("payout never negative", () => {
    const o = P.open(acct(), { side: "long", margin: 100, lev: 3, mark: 1000, now: 1, ch24: 0, ch1: 0 });
    if (!o.ok) throw new Error(o.error);
    expect(P.close(o.position, 500).payout).toBe(0);
  });

  test("liquidation from minute bars after the open only", () => {
    const o = P.open(acct(), { side: "long", margin: 1000, lev: 3, mark: 1000, now: 600, ch24: 0, ch1: 0 });
    if (!o.ok) throw new Error(o.error);
    const liq = o.position.liq;
    const bars = [
      { t: 540, h: 1001, l: 600, c: 1000 },
      { t: 660, h: 1000, l: 990, c: 995 },
      { t: 720, h: 995, l: liq - 1, c: 700 },
    ];
    const hit = P.liquidation(o.position, bars);
    expect(hit).toEqual({ t: 720, price: liq });
    expect(P.liquidation(o.position, bars.slice(0, 2))).toBeNull();
    const sh = P.open(acct(), { side: "short", margin: 1000, lev: 2, mark: 1000, now: 600, ch24: 0, ch1: 0 });
    if (!sh.ok) throw new Error(sh.error);
    expect(P.liquidation(sh.position, [{ t: 660, h: sh.position.liq + 0.01, l: 999, c: 1000 }])?.t).toBe(660);
  });

  test("equity", () => {
    const o = P.open(acct(), { side: "long", margin: 1000, lev: 2, mark: 1000, now: 1, ch24: 0, ch1: 0 });
    if (!o.ok) throw new Error(o.error);
    expect(Math.abs(P.equity(o.balance, [o.position], 1010) - (o.balance + 1000 + 20))).toBeLessThan(1e-9);
  });
});

describe("port = reference on random inputs (exact)", () => {
  // a small deterministic PRNG (mulberry32)
  let s = 0x5eed;
  const rnd = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

  test("maxLeverage, liqPrice, open, pnl, close, liquidation, equity: 5000 cases", () => {
    for (let i = 0; i < 5000; i++) {
      const ch24 = pick([0, null, undefined, NaN, (rnd() - 0.5) * 0.8, 0.1, -0.1, 0.25, -0.25]);
      const ch1 = pick([0, null, undefined, (rnd() - 0.5) * 0.12, 0.04, -0.04]);
      expect(Port.maxLeverage({ ch24, ch1 })).toEqual(REF.maxLeverage({ ch24, ch1 }));
      const side = pick(["long", "short", "up", ""]);
      const lev = pick([1, 2, 3, 4, 0, 2.5]);
      const mark = pick([rnd() * 2000, 0, -1, NaN, 1000]);
      const margin = pick([rnd() * 12000, 10, 9.99, NaN, 1000]);
      const account = { balance: pick([10000, rnd() * 10000, 0]), open: Math.floor(rnd() * 7) };
      const input = { side, margin, lev, mark, now: Math.floor(rnd() * 1e6), ch24, ch1 };
      const a = Port.open(account, input), b = REF.open(account, input);
      expect(a).toEqual(b);
      if (lev > 0) expect(Port.liqPrice(side, mark, lev)).toBe(REF.liqPrice(side, mark, lev));
      if (a.ok) {
        const pos = a.position;
        const at = rnd() * 2000;
        expect(Port.pnl(pos, at)).toBe(REF.pnl(pos, at));
        expect(Port.close(pos, at)).toEqual(REF.close(pos, at));
        expect(Port.equity(a.balance, [pos, pos], at)).toBe(REF.equity(a.balance, [pos, pos], at));
        const bars = Array.from({ length: 6 }, (_, k) => {
          const c = pos.entry * (0.5 + rnd());
          return { t: pos.openedAt - 120 + k * 60, h: c * (1 + rnd() * 0.3), l: c * (1 - rnd() * 0.5), c };
        });
        expect(Port.liquidation(pos, bars)).toEqual(REF.liquidation(pos, bars));
      }
    }
  });
});
