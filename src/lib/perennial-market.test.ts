import { describe, expect, test } from "vitest";
import {
  COMPARATOR,
  GAS_RESERVE_USDC,
  OUTCOME,
  PHASE,
  SETTLEMENT,
  blockChunks,
  formatUsdc,
  isqrt,
  marketStatus,
  maxDeposit,
  minOutWithSlippage,
  nextMilestoneThreshold,
  parseDays,
  parseSlippagePct,
  parseUsdcInput,
  questionText,
  quoteBuy,
  quoteSell,
  redeemPayout,
  settlementRuleText,
  splitFee,
  voidPayout,
} from "./perennial-market";

const seeded = { yesReserve: 5_000_000n, noReserve: 5_000_000n };

describe("quoteBuy mirrors MarketsPerennial.buy", () => {
  test("reproduces the on-chain testnet trade (2 USDC YES into a 5/5 pool)", () => {
    // deployments/arc-testnet.json settlementProof: reserves after were
    // yes 3,578,586 / no 6,986,000 and the buyer redeemed 3,407,414.
    const q = quoteBuy(seeded, OUTCOME.Yes, 2_000_000n, 70n)!;
    expect(q.fee).toBe(14_000n);
    expect(q.sharesOut).toBe(3_407_414n);
    expect(q.reservesAfter).toEqual({ yesReserve: 3_578_586n, noReserve: 6_986_000n });
  });

  test("fee, average price and impact", () => {
    const q = quoteBuy(seeded, OUTCOME.Yes, 2_000_000n, 70n)!;
    expect(q.priceBefore).toBeCloseTo(0.5, 12);
    expect(q.avgPrice).toBeCloseTo(2_000_000 / 3_407_414, 9);
    // ex-fee average 1,986,000/3,407,414 = 0.58284 vs 0.5 marginal
    expect(q.priceImpact).toBeCloseTo(1_986_000 / 3_407_414 / 0.5 - 1, 9);
    expect(q.priceAfter).toBeGreaterThan(q.priceBefore);
  });

  test("NO is symmetric to YES on a balanced pool", () => {
    const y = quoteBuy(seeded, OUTCOME.Yes, 1_000_000n, 70n)!;
    const n = quoteBuy(seeded, OUTCOME.No, 1_000_000n, 70n)!;
    expect(n.sharesOut).toBe(y.sharesOut);
    expect(n.reservesAfter).toEqual({ yesReserve: y.reservesAfter.noReserve, noReserve: y.reservesAfter.yesReserve });
  });

  test("zero fee has zero fee and tiny size has ~zero impact", () => {
    const q = quoteBuy(seeded, OUTCOME.Yes, 1_000n, 0n)!;
    expect(q.fee).toBe(0n);
    expect(Math.abs(q.priceImpact)).toBeLessThan(0.001);
  });

  test("rejects empty input and empty pools", () => {
    expect(quoteBuy(seeded, OUTCOME.Yes, 0n, 70n)).toBeNull();
    expect(quoteBuy({ yesReserve: 0n, noReserve: 0n }, OUTCOME.Yes, 1n, 70n)).toBeNull();
  });
});

describe("quoteSell mirrors MarketsPerennial.sell", () => {
  test("gross out solves the constant product exactly (floor)", () => {
    const r = { yesReserve: 3_578_586n, noReserve: 6_986_000n };
    const q = quoteSell(r, OUTCOME.Yes, 1_000_000n, 70n)!;
    const k = r.yesReserve * r.noReserve;
    const y = r.yesReserve + 1_000_000n;
    const n = r.noReserve;
    expect((y - q.grossOut) * (n - q.grossOut)).toBeGreaterThanOrEqual(k);
    expect((y - q.grossOut - 1n) * (n - q.grossOut - 1n)).toBeLessThan(k);
    expect(q.fee).toBe((q.grossOut * 70n) / 10_000n);
    expect(q.collateralOut).toBe(q.grossOut - q.fee);
  });

  test("buy then sell the same shares loses the two fees and nothing is created", () => {
    const b = quoteBuy(seeded, OUTCOME.No, 3_000_000n, 70n)!;
    const s = quoteSell(b.reservesAfter, OUTCOME.No, b.sharesOut, 70n)!;
    expect(s.collateralOut).toBeLessThan(3_000_000n);
    expect(s.collateralOut).toBeGreaterThan(2_950_000n);
    expect(s.priceImpact).toBeGreaterThan(0);
  });

  test("isqrt is the floor root", () => {
    for (const n of [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, 10n ** 30n + 7n]) {
      const r = isqrt(n);
      expect(r * r <= n && (r + 1n) * (r + 1n) > n).toBe(true);
    }
  });
});

describe("slippage and fees", () => {
  test("min out from tolerance", () => {
    expect(minOutWithSlippage(1_000_000n, 100n)).toBe(990_000n);
    expect(minOutWithSlippage(1_000_000n, 50n)).toBe(995_000n);
    expect(() => minOutWithSlippage(1n, 10_000n)).toThrow();
  });
  test("parseSlippagePct", () => {
    expect(parseSlippagePct("1")).toEqual({ ok: true, value: 100n });
    expect(parseSlippagePct("0.5")).toEqual({ ok: true, value: 50n });
    expect(parseSlippagePct("0").ok).toBe(false);
    expect(parseSlippagePct("51").ok).toBe(false);
    expect(parseSlippagePct("abc").ok).toBe(false);
    expect(parseSlippagePct("0.001").ok).toBe(false);
  });
  test("fee split by governable bps, remainder to commons", () => {
    const s = splitFee(14_000n, { creatorBps: 20n, treasuryBps: 35n, agentBps: 15n });
    expect(s).toEqual({ creator: 4_000n, agent: 3_000n, commons: 7_000n });
    expect(s.creator + s.agent + s.commons).toBe(14_000n);
  });
});

describe("payouts", () => {
  test("voided pays $0.50 per share of either side", () => {
    expect(voidPayout(3_000_000n, 1_000_000n)).toBe(2_000_000n);
    expect(redeemPayout({ phase: PHASE.Voided, yesWon: false }, 3n, 0n)).toBe(1n);
  });
  test("resolved pays the winning side 1:1", () => {
    expect(redeemPayout({ phase: PHASE.Resolved, yesWon: true }, 5n, 7n)).toBe(5n);
    expect(redeemPayout({ phase: PHASE.Resolved, yesWon: false }, 5n, 7n)).toBe(7n);
    expect(redeemPayout({ phase: PHASE.Trading, yesWon: false }, 5n, 7n)).toBe(0n);
  });
});

describe("marketStatus", () => {
  const live = { expiry: 1_000n, supportsSettlement: true };
  test("loading / undefined phase is never settled", () => {
    const s = marketStatus({ ...live, phase: undefined, chainNow: 10n, settlement: undefined });
    expect(s.key).toBe("loading");
    expect(s.canRedeem || s.canTrade || s.canResolve).toBe(false);
    expect(marketStatus({ ...live, phase: 0, chainNow: undefined, settlement: undefined }).key).toBe("loading");
  });
  test("trading until chain time reaches expiry", () => {
    expect(marketStatus({ ...live, phase: 0, chainNow: 999n, settlement: SETTLEMENT.Open }).canTrade).toBe(true);
    const at = marketStatus({ ...live, phase: 0, chainNow: 1_000n, settlement: SETTLEMENT.Waiting });
    expect(at.canTrade).toBe(false);
    expect(at.key).toBe("waiting");
  });
  test("resolvable / voidable", () => {
    const r = marketStatus({ ...live, phase: 0, chainNow: 2_000n, settlement: SETTLEMENT.Resolvable });
    expect([r.key, r.canResolve, r.canVoid]).toEqual(["resolvable", true, false]);
    const v = marketStatus({ ...live, phase: 0, chainNow: 2_000n, settlement: SETTLEMENT.Voidable });
    expect([v.key, v.canVoid, v.canResolve]).toEqual(["voidable", true, false]);
  });
  test("terminal phases", () => {
    const y = marketStatus({ ...live, phase: PHASE.Resolved, yesWon: true, chainNow: 2_000n, settlement: undefined });
    expect([y.key, y.label, y.canRedeem, y.canClaimLP]).toEqual(["resolved-yes", "Resolved · YES won", true, true]);
    expect(marketStatus({ ...live, phase: PHASE.Resolved, yesWon: false, chainNow: 2_000n, settlement: undefined }).key).toBe("resolved-no");
    const v = marketStatus({ ...live, phase: PHASE.Voided, chainNow: 2_000n, settlement: undefined });
    expect(v.key).toBe("voided");
    expect(v.detail).toContain("$0.50");
  });
  test("legacy contract: expired market hides settle and void", () => {
    const s = marketStatus({ ...live, supportsSettlement: false, phase: 0, chainNow: 2_000n, settlement: undefined });
    expect(s.key).toBe("closed-legacy");
    expect(s.canResolve || s.canVoid || s.canTrade).toBe(false);
    expect(s.detail).toContain("legacy contract");
  });
});

describe("copy", () => {
  test("question text is derived from the parameters", () => {
    const q = questionText({
      subject: "Otus",
      metric: "verified artifacts",
      feedId: "0x5feff482b8ba79c844c057b4420ec15aee6d050ad645a79c919223b14d7c195a",
      threshold: 4n,
      comparator: COMPARATOR.GreaterOrEqual,
      expiry: 1_790_267_782n,
    });
    expect(q).toBe("Otus: verified artifacts ≥ 4 at the first attestation after 2026-09-24 16:36 UTC?");
  });
  test("unknown feeds name the feed id", () => {
    const q = questionText({
      subject: "Builder #1",
      feedId: "0x5feff482b8ba79c844c057b4420ec15aee6d050ad645a79c919223b14d7c195a",
      threshold: 17_000n,
      comparator: COMPARATOR.GreaterThan,
      expiry: 0n,
    });
    expect(q).toContain("feed 0x5fef…195a value > 17000");
  });
  test("settlement rule names the window and the $0.50 void payout", () => {
    expect(settlementRuleText(86_400)).toContain("expiry + 1d");
    expect(settlementRuleText(86_400)).toContain("$0.50");
    expect(settlementRuleText(undefined)).toContain("the settlement window");
  });
  test("threshold is latest attested count + 1", () => {
    expect(nextMilestoneThreshold(null)).toBe(1n);
    expect(nextMilestoneThreshold(0n)).toBe(1n);
    expect(nextMilestoneThreshold(7n)).toBe(8n);
    expect(nextMilestoneThreshold(-3n)).toBe(1n);
  });
});

describe("inputs", () => {
  test("USDC amounts", () => {
    expect(parseUsdcInput("1.5")).toEqual({ ok: true, value: 1_500_000n });
    expect(parseUsdcInput(".25")).toEqual({ ok: true, value: 250_000n });
    expect(parseUsdcInput("").ok).toBe(false);
    expect(parseUsdcInput("abc").ok).toBe(false);
    expect(parseUsdcInput("NaN").ok).toBe(false);
    expect(parseUsdcInput("-1").ok).toBe(false);
    expect(parseUsdcInput("0").ok).toBe(false);
    expect(parseUsdcInput("1.0000001").ok).toBe(false);
    expect(parseUsdcInput("1e3").ok).toBe(false);
    expect(parseUsdcInput("4", { min: 5_000_000n }).ok).toBe(false);
    const over = parseUsdcInput("10", { max: 2_500_000n });
    expect(over.ok ? "" : over.error).toBe("Maximum amount is 2.5 USDC.");
  });
  test("days", () => {
    expect(parseDays("7")).toEqual({ ok: true, value: 7 });
    expect(parseDays("1.5").ok).toBe(false);
    expect(parseDays("-2").ok).toBe(false);
    expect(parseDays("0").ok).toBe(false);
    expect(parseDays("x").ok).toBe(false);
    expect(parseDays("400").ok).toBe(false);
  });
  test("deposit max keeps a gas reserve", () => {
    expect(maxDeposit(10_000_000n)).toBe(10_000_000n - GAS_RESERVE_USDC);
    expect(maxDeposit(GAS_RESERVE_USDC)).toBe(0n);
    expect(maxDeposit(50_000n)).toBe(0n);
  });
  test("balances format rounded down", () => {
    expect(formatUsdc(1_999_999n)).toBe("1.99");
    expect(formatUsdc(1_000_000n)).toBe("1");
    expect(formatUsdc(1_050_000n)).toBe("1.05");
    expect(formatUsdc(9n, 6)).toBe("0.000009");
  });
  test("block chunks never exceed the cap", () => {
    expect(blockChunks(0n, 9_999n)).toEqual([[0n, 4_999n], [5_000n, 9_999n]]);
    expect(blockChunks(10n, 10n)).toEqual([[10n, 10n]]);
    expect(blockChunks(10n, 9n)).toEqual([]);
    for (const [a, b] of blockChunks(1n, 123_456n)) expect(b - a + 1n <= 5_000n).toBe(true);
  });
});
