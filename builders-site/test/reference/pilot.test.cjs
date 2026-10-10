const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("./pilot.cjs");

const R = P.RULES;
const acct = (balance = 10000) => ({ balance, open: 0 });
const calm = { sigma24: 0.0005, sigma1h: 0.0001, ch1: 0 };
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test("risk: trend over 6 h with milestone steps divided out; σ over 24 h", () => {
  const closes = [1000]; for (let i = 0; i < 30; i++) closes.push(closes[i] * (1 - 0.0002));
  near(P.risk(closes).trend, -0.0002, 1e-12);
  const jumped = closes.slice(); for (let i = 28; i < jumped.length; i++) jumped[i] *= 1.025;   // a +2.5% milestone at return 28
  near(P.risk(jumped, { 28: 1.025 }).trend, -0.0002, 1e-12);
  assert.ok(P.risk(jumped).trend > 0.003);                         // without the step removed it would swamp funding
  assert.deepEqual(P.risk([1000]), { trend: null, funding: null, sigma1h: null, sigma24: null });
});

test("leverage: jump cap 30× even when volatility allows more", () => {
  assert.equal(P.maxLeverage({ sigma24: 0.0005, sigma1h: 0.0001, ch1: 0 }).max, 30);   // vol cap 200, jump cap 33
  assert.equal(P.maxLeverage({ sigma24: 0.012, sigma1h: 0.002, ch1: 0 }).max, 5);       // vol cap 8
  assert.equal(P.open(acct(), { side: "long", margin: 100, lev: 50, mark: 1000, now: 0, risk: calm }).error, "leverage not allowed");
  const { position } = P.open(acct(), { side: "short", margin: 1000, lev: 30, mark: 1000, now: 0, risk: calm });
  assert.ok(P.pnl(position, 1025) > -position.margin);            // a 2.5% jump against 30× stays inside the margin
});

test("funding: trend term on everyone, skew term heavy pays |r|, light (incl. house) receives 90%", () => {
  const fr = P.fundingRates({ L: 70000, S: 30000, trend: -0.0002, sigma1h: 0.0001 });
  near(fr.skew, 0.4); near(fr.rMax, 0.00015); near(fr.r, 0.00006);
  assert.equal(fr.heavy, "long");
  near(fr.long, -0.0002 + 0.00006);                  // long receives the drift, pays the skew rate
  near(fr.short, 0.0002 - 0.9 * 0.00006);            // short pays the drift, receives 90% of the skew rate
  near(fr.houseExposure, -40000);                    // house short the net 40k
  near(fr.cut, 0.1 * 0.00006 * 70000);
});

test("conservation: traders' funding + the house's receipts = 0", () => {
  for (const [L, S, tr] of [[70000, 30000, -0.0002], [10000, 90000, 0.0003], [0, 50000, -0.0001], [5e5, 5e5, 0.0001]]) {
    const fr = P.fundingRates({ L, S, trend: tr, sigma1h: 0.0001 });
    near(fr.long * L + fr.short * S - fr.houseFunding, 0, 1e-9);
  }
});

test("the house is drift-neutral: trend receipts offset the drift on its exposure", () => {
  const tr = -0.00028, L = 200000, S = 900000;       // crowd rides the down-drift: house long 700k
  const h = P.houseHour({ L, S, open: 1000, close: 1000 * (1 + tr), trend: tr, sigma1h: 0.00005 });
  near(h.pricePnl + P.fundingRates({ L, S, trend: tr, sigma1h: 0.00005 }).houseTrend, 0, 1e-6);   // drift cancels
  assert.ok(h.total > 0);                            // left over: skew receipts + cut
});

test("light side empty: heavy pays, the house (whole light side) and the cut take it", () => {
  const fr = P.fundingRates({ L: 0, S: 50000, trend: 0, sigma1h: 0.0001 });
  assert.equal(fr.heavy, "short");
  near(fr.houseFunding, fr.paid);
});

test("funding and borrow accrue pro rata and move the liquidation price", () => {
  const { position: L } = P.open(acct(), { side: "long", margin: 1000, lev: 10, mark: 1000, now: 1800, risk: calm });
  const rates = [{ t: 0, long: 0.0002, short: -0.00018 }, { t: 3600, long: 0.0002, short: -0.00018 }];
  near(P.fundingPaid(L, rates, 7200), 0.0002 * 10000 * 1.5);
  near(P.fundingAccrued(L, rates, 7200), -3);
  assert.ok(P.liqPrice(L, P.fundingPaid(L, rates, 7200) + P.borrowPaid(L, 7200)) > P.liqPrice(L, 0));
  near(P.fundingPaid(L, [{ t: 0, rate: 0.0001 }], 3600), 0.0001 * 10000 * 0.5);   // v2 rate format still accepted
});

test("close: payout = margin + PnL − funding − borrow − fee, never below 0", () => {
  const { position } = P.open(acct(), { side: "short", margin: 1000, lev: 10, mark: 1000, now: 0, risk: calm });
  const c = P.close(position, 990, 3600, [{ t: 0, long: 0.0003, short: -0.0002 }]);
  near(c.pnl, 100); near(c.funding, 2); near(c.borrow, 9000 * 0.1 / 8760);
  near(c.payout, 1000 + 100 + 2 - c.borrow - c.fee);
  const { position: p2 } = P.open(acct(), { side: "long", margin: 100, lev: 30, mark: 1000, now: 0, risk: calm });
  assert.equal(P.close(p2, 900, 3600, []).payout, 0);
});

test("liquidation reports a gap shortfall for the insurance pool", () => {
  const { position } = P.open(acct(), { side: "short", margin: 1000, lev: 30, mark: 1000, now: 0, risk: calm });
  assert.ok(P.liquidation(position, [{ t: 60, h: 1040, l: 1000, c: 1040 }], []).shortfall > 0);   // 4% gap
  assert.equal(P.liquidation(position, [{ t: 60, h: 1030, l: 1000, c: 1030 }], []).shortfall, 0);   // liq at +2.83%
  assert.equal(P.liquidation(position, [{ t: 60, h: 1010, l: 1000, c: 1010 }], []), null);
});

test("one direction per wallet; a hedged pair across two wallets loses the cut + borrow", () => {
  assert.equal(P.open({ balance: 1e4, open: 1, side: "long" }, { side: "short", margin: 100, lev: 2, mark: 1000, now: 0, risk: calm }).error, "one direction at a time");
  const fr = P.fundingRates({ L: 80000, S: 20000, trend: 0, sigma1h: 0.0002 });
  const rates = [{ t: 0, long: fr.long, short: fr.short }];
  const { position: a } = P.open(acct(), { side: "long", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm });
  const { position: b } = P.open(acct(), { side: "short", margin: 1000, lev: 20, mark: 1000, now: 0, risk: calm });
  for (const px of [995, 1000, 1005]) {
    const s = P.close(a, px, 3600, rates).payout + P.close(b, px, 3600, rates).payout;
    assert.ok(s < 2000, `pair returned ${s}`);
  }
});

test("fee split", () => {
  const s = P.splitFees(1000);
  near(s.insurance, 200); near(s.treasury, 800); near(s.buyback, 400);
});
