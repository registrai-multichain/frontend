const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("./pilot.cjs");

const R = P.RULES;
const acct = (balance = 10000) => ({ balance, open: 0 });
const calm = { sigma24: 0.002, sigma1h: 0.0004, ch1: 0 };      // → max lev 20
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test("risk: funding = mean hourly return over the funding window, sigma over 24 h scaled by √24", () => {
  const closes = [1000]; for (let i = 0; i < 30; i++) closes.push(closes[closes.length - 1] * (i % 2 ? 0.999 : 1.0005));
  const rk = P.risk(closes);
  const r6 = P.returns(closes).slice(-R.window);
  near(rk.funding, r6.reduce((a, b) => a + b) / r6.length);
  near(rk.sigma24, rk.sigma1h * Math.sqrt(24));
});

test("dynamic leverage from volatility, snapped to allowed levels, and the pause", () => {
  assert.equal(P.maxLeverage({ sigma24: 0.002, sigma1h: 0.0004, ch1: 0 }).max, 20);
  assert.equal(P.maxLeverage({ sigma24: 0.012, sigma1h: 0.002, ch1: 0 }).max, 5);   // floor(8.33) → 8 → level 5
  assert.equal(P.maxLeverage({ sigma24: 0.04, sigma1h: 0.008, ch1: 0 }).max, 2);    // floor(2.5)
  assert.equal(P.maxLeverage({ sigma24: 0.5, sigma1h: 0.1, ch1: 0 }).max, 1);
  assert.equal(P.maxLeverage({ sigma24: 0, sigma1h: 0, ch1: 0 }).max, 20);
  assert.equal(P.maxLeverage({ sigma24: 0.002, sigma1h: 0.0004, ch1: 0.006 }).paused, true);   // floor 0.5%
  assert.equal(P.maxLeverage({ sigma24: 0.002, sigma1h: 0.0004, ch1: 0.004 }).paused, false);
  assert.equal(P.maxLeverage({ sigma24: 0.05, sigma1h: 0.002, ch1: 0.009 }).paused, false);    // 5σ = 1%
});

test("open: fee, notional, liquidation price at 20x", () => {
  const r = P.open(acct(), { side: "long", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm });
  assert.equal(r.ok, true);
  assert.equal(r.position.notional, 20000);
  near(r.fee, 20000 * R.feeRate);
  near(r.balance, 10000 - 1000 - r.fee);
  near(r.position.liq, 1000 * (1 - (1 / 20 - R.mm)));        // 4.5% below
});

test("open: refusals", () => {
  const base = { side: "long", margin: 1000, lev: 2, mark: 1000, now: 1, risk: calm };
  assert.equal(P.open(acct(500), base).error, "insufficient balance");
  assert.equal(P.open(acct(), { ...base, margin: 5 }).error, "margin below minimum");
  assert.equal(P.open(acct(), { ...base, lev: 4 }).error, "leverage not allowed");
  assert.equal(P.open(acct(), { ...base, lev: 20, risk: { sigma24: 0.04, sigma1h: 0.008, ch1: 0 } }).error, "leverage above the current cap");
  assert.equal(P.open(acct(), { ...base, risk: { ...calm, ch1: 0.01 } }).error, "trading paused");
  assert.equal(P.open({ balance: 10000, open: 5 }, base).error, "too many open positions");
});

test("funding: longs receive when the trend is down, pro rata to time held", () => {
  const { position: L } = P.open(acct(), { side: "long", margin: 1000, lev: 10, mark: 1000, now: 1800, risk: calm });
  const { position: S } = P.open(acct(), { side: "short", margin: 1000, lev: 10, mark: 1000, now: 1800, risk: calm });
  const rates = [{ t: 0, rate: -0.0004 }, { t: 3600, rate: -0.0004 }];
  near(P.fundingAccrued(L, rates, 7200), 0.0004 * 10000 * 1.5);    // half of hour 0 + hour 1
  near(P.fundingAccrued(S, rates, 7200), -0.0004 * 10000 * 1.5);
  near(P.fundingAccrued(L, rates, 1800), 0);
});

test("funding cancels a steady trend: long and short both break even before fees", () => {
  // index falls 0.04%/h for 24 h; funding in force = −0.04%/h
  const closes = [1000]; for (let i = 0; i < 24; i++) closes.push(closes[i] * (1 - 0.0004));
  const rates = Array.from({ length: 24 }, (_, i) => ({ t: i * 3600, rate: -0.0004 }));
  for (const side of ["long", "short"]) {
    const { position } = P.open(acct(), { side, margin: 1000, lev: 5, mark: 1000, now: 0, risk: calm });
    const c = P.close(position, closes[24], 24 * 3600, rates);
    near(c.pnl + c.funding, 0, 0.6);     // compounding residue only (≈ 0.5 pt on 5,000 notional)
  }
});

test("close: payout never negative, funding and fee included", () => {
  const { position } = P.open(acct(), { side: "long", margin: 100, lev: 20, mark: 1000, now: 0, risk: calm });
  assert.equal(P.close(position, 900, 3600, []).payout, 0);
  const { position: p2 } = P.open(acct(), { side: "short", margin: 1000, lev: 2, mark: 1000, now: 0, risk: calm });
  const c = P.close(p2, 990, 3600, [{ t: 0, rate: 0.001 }]);
  near(c.pnl, 20); near(c.funding, 2); near(c.fee, 1980 * R.feeRate);
  near(c.payout, 1000 + 20 + 2 - 1980 * R.feeRate);
});

test("liquidation uses bars after the open and moves with funding", () => {
  const { position } = P.open(acct(), { side: "long", margin: 1000, lev: 20, mark: 1000, now: 600, risk: calm });
  const bars = [{ t: 540, h: 1000, l: 900, c: 1000 }, { t: 600, h: 1001, l: 999, c: 1000 }, { t: 660, h: 1000, l: 954, c: 960 }];
  const hit = P.liquidation(position, bars, []);
  assert.equal(hit.t, 660); near(hit.price, 955);
  // shorts paying funding (positive rate) pushes a short's liquidation closer
  const { position: s } = P.open(acct(), { side: "short", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm });
  const rates = [{ t: 0, rate: 0.002 }];
  const lpNoF = P.liqPrice(s, 0), lpF = P.liqPrice(s, P.fundingAccrued(s, rates, 3600));
  assert.ok(lpF > lpNoF);           // short receives +F: liquidation moves away
  const { position: l2 } = P.open(acct(), { side: "long", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm });
  assert.ok(P.liqPrice(l2, P.fundingAccrued(l2, rates, 3600)) > P.liqPrice(l2, 0));   // long pays: closer
  assert.equal(P.liquidation(position, bars.slice(0, 2), []), null);
});

test("one direction per wallet: no hedging", () => {
  const base = { margin: 100, lev: 2, mark: 1000, now: 0, risk: calm };
  assert.equal(P.open({ balance: 10000, open: 1, side: "long" }, { ...base, side: "short" }).error, "one direction at a time");
  assert.equal(P.open({ balance: 10000, open: 1, side: "long" }, { ...base, side: "long" }).ok, true);
  assert.equal(P.open({ balance: 10000, open: 0, side: "long" }, { ...base, side: "short" }).ok, true);
});

test("risk with fewer than 2 closes is unknown, not zero", () => {
  assert.deepEqual(P.risk([1000]), { funding: null, sigma1h: null, sigma24: null });
});

test("a hedged pair (across two wallets) cannot mint points", () => {
  const rates = [{ t: 0, rate: -0.0005 }, { t: 3600, rate: 0.0003 }];
  const { position: L } = P.open(acct(), { side: "long", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm });
  const { position: S } = P.open(acct(), { side: "short", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm });
  for (const px of [990, 1000, 1010]) {
    const a = P.close(L, px, 7200, rates), b = P.close(S, px, 7200, rates);
    assert.ok(a.payout + b.payout < 2000, `pair at ${px} returned ${a.payout + b.payout}`);
  }
});
