import { describe, expect, test } from "vitest";
import { OUTCOME, PHASE, SETTLEMENT, bpsPct, marketStatus, quoteBuy, settlementRuleText } from "./perennial-market";
import {
  feeHeadline,
  feeModelFromProbe,
  feeSummary,
  lpClaimPayout,
  mirrorClaimLP,
  mirrorRedeem,
  mirrorResolve,
  mirrorVoid,
  netCostMinusFee,
  resolvedPayout,
  splitResolutionFee,
  ticketFeeLabel,
  tradeFeeBps,
  voidIsProRata,
  voidRefund,
  voidRefundText,
  type FeeModel,
} from "./resolution-fee";

const V2: FeeModel = feeModelFromProbe({ resolution: { feeBps: 100n, creator: 3_000n, agent: 2_000n, commons: 5_000n }, legacy: null }, "perennial");
const V4: FeeModel = feeModelFromProbe({ resolution: { feeBps: 100n, creator: 3_000n, agent: 2_000n, commons: 5_000n }, legacy: null }, "v4");
const LEGACY: FeeModel = feeModelFromProbe({ resolution: null, legacy: { totalBps: 70n, creator: 20n, agent: 15n, commons: 35n } }, "perennial");
const v2 = V2 as Extract<FeeModel, { kind: "resolution" }>;

describe("fee split display", () => {
  test("the spec's line, exactly", () => {
    expect(feeSummary(V2)).toBe("1% at settlement · 30% creator · 20% agent · 50% builder commons");
    expect(feeSummary(V4)).toBe("1% at settlement · 30% creator · 20% agent · 50% Registrai treasury");
  });
  test("the ticket says there is no trading fee", () => {
    expect(ticketFeeLabel(V2)).toBe("no trading fee — 1% at settlement");
    expect(feeHeadline(V2)).toBe("1% at settlement");
  });
  test("legacy contracts show their per-trade fee", () => {
    expect(feeSummary(LEGACY)).toBe("0.7% per trade · creator 0.2% · agent 0.15% · builder commons 0.35%");
    expect(ticketFeeLabel(LEGACY)).toBe("0.7% per trade");
    expect(feeHeadline(LEGACY)).toBe("0.7% per trade");
  });
  test("unknown hides fee detail", () => {
    const u: FeeModel = { kind: "unknown" };
    expect(feeSummary(u)).toBeUndefined();
    expect(feeHeadline(u)).toBeUndefined();
    expect(feeSummary(undefined)).toBeUndefined();
  });
  test("bpsPct trims", () => {
    expect([100n, 3_000n, 2_000n, 5_000n, 70n, 35n, 15n].map(bpsPct)).toEqual(["1%", "30%", "20%", "50%", "0.7%", "0.35%", "0.15%"]);
  });
});

describe("capability fallback", () => {
  test("v2 when RESOLUTION_FEE_BPS answers; missing shares fall back to the fixed constants", () => {
    const m = feeModelFromProbe({ resolution: { feeBps: 100n }, legacy: null }, "v4");
    expect(m).toEqual({
      kind: "resolution", resolutionFeeBps: 100n, creatorShareBps: 3_000n, agentShareBps: 2_000n, commonsShareBps: 5_000n,
      commonsLabel: "Registrai treasury",
    });
    expect(tradeFeeBps(m)).toBe(0n);
  });
  test("legacy when only FEE_BPS_TOTAL answers; split hidden if any leg is unreadable", () => {
    expect(tradeFeeBps(LEGACY)).toBe(70n);
    const partial = feeModelFromProbe({ resolution: null, legacy: { totalBps: 70n, creator: 20n } }, "perennial");
    expect(partial.kind).toBe("legacy");
    expect(partial.kind === "legacy" && partial.split).toBeUndefined();
    expect(feeSummary(partial)).toBe("0.7% per trade");
  });
  test("unknown when neither answers — no trade fee is assumed", () => {
    const m = feeModelFromProbe({ resolution: null, legacy: null }, "perennial");
    expect(m).toEqual({ kind: "unknown" });
    expect(tradeFeeBps(m)).toBeUndefined();
    expect(tradeFeeBps(undefined)).toBeUndefined();
  });
});

describe("resolution fee mirror (net / gross)", () => {
  test("1% of the pot split 30/20/50", () => {
    expect(splitResolutionFee(10_000_000n, v2)).toEqual({ fee: 100_000n, creator: 30_000n, agent: 20_000n, commons: 50_000n });
  });
  test("rounding: creator and agent floor, commons takes the remainder", () => {
    const s = splitResolutionFee(1_234_567n, v2);
    expect(s).toEqual({ fee: 12_345n, creator: 3_703n, agent: 2_469n, commons: 6_173n });
    expect(s.creator + s.agent + s.commons).toBe(s.fee);
  });
  test("resolve: gross = C, net = C − F", () => {
    expect(mirrorResolve(7_000_000n, 100n)).toEqual({ settledGross: 7_000_000n, settledNet: 6_930_000n, fee: 70_000n });
  });
  test("a fee-free buy then resolve pays winners and LP 99% of the pot, never more", () => {
    // 5 USDC seed, 2 USDC YES buy, no trading fee: the pot is 7 USDC.
    const seeded = { yesReserve: 5_000_000n, noReserve: 5_000_000n };
    const q = quoteBuy(seeded, OUTCOME.Yes, 2_000_000n)!;
    const C = 7_000_000n;
    expect(q.sharesOut + q.reservesAfter.yesReserve).toBe(C); // YES supply == C
    const { settledNet, settledGross } = mirrorResolve(C, 100n);
    const winner = resolvedPayout(q.sharesOut, settledNet, settledGross);
    const lpPot = resolvedPayout(q.reservesAfter.yesReserve, settledNet, settledGross);
    expect(winner).toBe(3_394_285n);
    expect(lpPot).toBe(3_535_714n);
    expect(winner + lpPot).toBeLessThanOrEqual(settledNet);
    expect(settledNet - (winner + lpPot)).toBeLessThanOrEqual(2n);
    expect(lpClaimPayout(5_000_000n, lpPot, 5_000_000n)).toBe(lpPot);
  });
  test("zero gross pays nothing", () => {
    expect(resolvedPayout(5n, 0n, 0n)).toBe(0n);
  });
});

describe("void refund mirror", () => {
  test("covered pool: every trader gets net cost minus 1%", () => {
    const v = mirrorVoid(7_000_000n, 2_000_000n, 100n);
    expect(v).toEqual({ fee: 70_000n, avail: 6_930_000n, voidTraderPool: 1_980_000n, voidNetCostTotal: 2_000_000n, lpPot: 4_950_000n });
    expect(voidRefund(2_000_000n, v.voidTraderPool, v.voidNetCostTotal)).toBe(1_980_000n);
    expect(voidRefund(2_000_000n, v.voidTraderPool, v.voidNetCostTotal)).toBe(netCostMinusFee(2_000_000n, 100n));
    expect(voidIsProRata(v.voidTraderPool, v.voidNetCostTotal, 100n)).toBe(false);
  });
  test("pro rata when earlier sellers took out more than the LP seed", () => {
    // Pot 8 USDC but 10 USDC of outstanding net cost: 99% of 10 > 8 − 1%.
    const v = mirrorVoid(8_000_000n, 10_000_000n, 100n);
    expect(v.voidTraderPool).toBe(7_920_000n);
    expect(v.lpPot).toBe(0n);
    expect(voidIsProRata(v.voidTraderPool, v.voidNetCostTotal, 100n)).toBe(true);
    const a = voidRefund(4_000_000n, v.voidTraderPool, v.voidNetCostTotal);
    const b = voidRefund(6_000_000n, v.voidTraderPool, v.voidNetCostTotal);
    expect([a, b]).toEqual([3_168_000n, 4_752_000n]);
    expect(a + b).toBeLessThanOrEqual(v.voidTraderPool);
  });
  test("floors each refund; nothing owed pays nothing", () => {
    expect(voidRefund(3n, 99n, 100n)).toBe(2n);
    expect(voidRefund(5n, 0n, 0n)).toBe(0n);
  });
  test("preview copy", () => {
    expect(voidRefundText(2_000_000n, 1_980_000n, 100n)).toBe("your net cost $2 minus 1% = $1.98");
    expect(voidRefundText(4_000_000n, 3_168_000n, 100n, true)).toContain("pro rata");
  });
});

describe("mirrorRedeem / mirrorClaimLP", () => {
  const holder = { yes: 3_428_571n, no: 10n, lp: 0n, netCost: 2_000_000n };
  const base = { yesWon: true, lpPot: 3_535_714n, totalLpShares: 5_000_000n };
  test("trading pays nothing", () => {
    expect(mirrorRedeem({ ...base, phase: PHASE.Trading }, holder, V2)).toBe(0n);
    expect(mirrorClaimLP({ ...base, phase: PHASE.Trading }, { lp: 5n })).toBe(0n);
  });
  test("v2 resolved uses net / gross on the winning side only", () => {
    const s = { ...base, phase: PHASE.Resolved, settledNet: 6_930_000n, settledGross: 7_000_000n };
    expect(mirrorRedeem(s, holder, V2)).toBe(3_394_285n);
    expect(mirrorRedeem({ ...s, yesWon: false }, holder, V2)).toBe(9n);
    expect(mirrorClaimLP(s, { lp: 5_000_000n })).toBe(3_535_714n);
  });
  test("v2 voided refunds net cost, ignoring which side was held", () => {
    const s = { ...base, phase: PHASE.Voided, voidTraderPool: 1_980_000n, voidNetCostTotal: 2_000_000n };
    expect(mirrorRedeem(s, holder, V2)).toBe(1_980_000n);
  });
  test("v2 without the snapshot or net cost is undefined (UI then relies on the view)", () => {
    expect(mirrorRedeem({ ...base, phase: PHASE.Resolved }, holder, V2)).toBeUndefined();
    expect(mirrorRedeem({ ...base, phase: PHASE.Voided, voidTraderPool: 1n, voidNetCostTotal: 1n }, { ...holder, netCost: undefined }, V2)).toBeUndefined();
  });
  test("legacy keeps 1:1 winners and $0.50 voids", () => {
    expect(mirrorRedeem({ ...base, phase: PHASE.Resolved }, holder, LEGACY)).toBe(3_428_571n);
    expect(mirrorRedeem({ ...base, phase: PHASE.Voided }, { yes: 3n, no: 1n, lp: 0n }, LEGACY)).toBe(2n);
  });
});

describe("status and rule copy follow the fee model", () => {
  const live = { expiry: 1_000n, chainNow: 2_000n, supportsSettlement: true, settlement: undefined };
  test("void copy: net cost minus 1%, agent's 20% to its successful challenger", () => {
    const v = marketStatus({ ...live, phase: PHASE.Voided, feeModel: V2 });
    expect(v.detail).toContain("refunds net cost minus 1%");
    expect(v.detail).toContain("agent's 20% to its successful challenger");
    expect(v.detail).not.toContain("$0.50");
    const vv = marketStatus({ ...live, phase: 0, settlement: SETTLEMENT.Voidable, feeModel: V2 });
    expect(vv.detail).toContain("net cost back minus 1%");
  });
  test("resolved copy mentions the resolution fee, not $1.00", () => {
    const r = marketStatus({ ...live, phase: PHASE.Resolved, yesWon: true, feeModel: V2 });
    expect(r.detail).toContain("1% resolution fee");
    expect(r.detail).not.toContain("$1.00");
  });
  test("rule text", () => {
    const t = settlementRuleText(86_400, V2);
    expect(t).toContain("net cost back, minus the 1% fee");
    expect(t).toContain("20% goes to whoever successfully challenged");
    expect(t).not.toContain("$0.50");
    expect(settlementRuleText(86_400, V4)).toContain("otherwise to the Registrai treasury");
    expect(settlementRuleText(86_400, LEGACY)).toContain("$0.50");
  });
});
