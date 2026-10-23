import { describe, expect, test } from "vitest";
import { OUTCOME, PHASE, SETTLEMENT, bpsPct, marketStatus, quoteBuy, quoteSell, settlementRuleText } from "./perennial-market";
import {
  feeHeadline,
  feeModelFromProbe,
  feeSummary,
  lpClaimPayout,
  mirrorClaimLP,
  mirrorRedeem,
  mirrorVoid,
  payeeLabel,
  payeeShort,
  splitTradeFee,
  tradeFeeBps,
  voidIsProRata,
  voidRefund,
  voidRefundText,
  voidSinkLabel,
  type FeeModel,
} from "./market-fees";

const V3: FeeModel = feeModelFromProbe({ v3: { feeBps: 100n, creator: 3_000n, agent: 2_000n, payee: 5_000n }, legacy: null }, "perennial");
/** A MarketsPerennial from before the BuilderFund (COMMONS_SHARE_BPS). */
const PRE_FUND: FeeModel = feeModelFromProbe({ v3: { feeBps: 100n, creator: 3_000n, agent: 2_000n, payee: 5_000n, commonsLeg: true }, legacy: null }, "perennial");
const V4: FeeModel = feeModelFromProbe({ v3: { feeBps: 100n, creator: 3_000n, agent: 2_000n, payee: 5_000n }, legacy: null }, "v4");
const LEGACY: FeeModel = feeModelFromProbe({ v3: null, legacy: { totalBps: 70n, creator: 20n, agent: 15n, payee: 35n } }, "perennial");
const seeded = { yesReserve: 5_000_000n, noReserve: 5_000_000n };

describe("fee split display", () => {
  test("the ticket line, exactly", () => {
    expect(feeSummary(V3)).toBe("1% trading fee · 30% creator · 20% agent (held until settlement) · 50% builder (income, taxed per epoch)");
    expect(feeSummary(PRE_FUND)).toBe("1% trading fee · 30% creator · 20% agent (held until settlement) · 50% builder commons (contract from before the BuilderFund)");
    expect(feeSummary(V4)).toBe("1% trading fee · 30% creator · 20% agent (held until settlement) · 50% Registrai treasury");
    expect(feeHeadline(V3)).toBe("1% per trade");
  });
  test("legacy contracts show their own per-trade fee", () => {
    expect(feeSummary(LEGACY)).toBe("0.7% trading fee (legacy contract) · creator 0.2% · agent 0.15% · builder commons 0.35% of each trade");
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

describe("payee labels", () => {
  test("where the 50% leg and an unchallenged void escrow go", () => {
    expect([payeeLabel(V3), payeeShort(V3), voidSinkLabel(V3)]).toEqual(["builder (income, taxed per epoch)", "builder", "season pool"]);
    expect([payeeLabel(PRE_FUND), payeeShort(PRE_FUND), voidSinkLabel(PRE_FUND)]).toEqual(["builder commons", "commons", "builder commons"]);
    expect([payeeLabel(V4), payeeShort(V4), voidSinkLabel(V4)]).toEqual(["Registrai treasury", "treasury", "Registrai treasury"]);
    expect(payeeLabel({ kind: "unknown" })).toBeUndefined();
  });
});

describe("capability fallback", () => {
  test("v3 when TRADE_FEE_BPS answers; missing shares fall back to the fixed constants", () => {
    const m = feeModelFromProbe({ v3: { feeBps: 100n }, legacy: null }, "v4");
    expect(m).toEqual({
      kind: "trade", tradeFeeBps: 100n, creatorShareBps: 3_000n, agentShareBps: 2_000n, payeeShareBps: 5_000n,
      payee: "treasury",
    });
    expect(tradeFeeBps(m)).toBe(100n);
  });
  test("legacy when only FEE_BPS_TOTAL answers; split hidden if any leg is unreadable", () => {
    expect(tradeFeeBps(LEGACY)).toBe(70n);
    const partial = feeModelFromProbe({ v3: null, legacy: { totalBps: 70n, creator: 20n } }, "perennial");
    expect(partial.kind === "legacy" && partial.split).toBeUndefined();
    expect(splitTradeFee(14_000n, partial)).toBeUndefined();
  });
  test("unknown when neither answers — no fee is assumed, so no quote", () => {
    const m = feeModelFromProbe({ v3: null, legacy: null }, "perennial");
    expect(m).toEqual({ kind: "unknown" });
    expect(tradeFeeBps(m)).toBeUndefined();
    expect(tradeFeeBps(undefined)).toBeUndefined();
  });
});

describe("per-trade fee split", () => {
  test("v3: 30/20/50 of the 1%", () => {
    const q = quoteBuy(seeded, OUTCOME.Yes, 10_000_000n, tradeFeeBps(V3)!)!;
    expect(q.fee).toBe(100_000n);
    expect(splitTradeFee(q.fee, V3)).toEqual({ creator: 30_000n, agent: 20_000n, payee: 50_000n });
  });
  test("v3 rounding: creator and agent floor, the builder takes the remainder", () => {
    const s = splitTradeFee(12_345n, V3)!;
    expect(s).toEqual({ creator: 3_703n, agent: 2_469n, payee: 6_173n });
    expect(s.creator + s.agent + s.payee).toBe(12_345n);
  });
  test("a sell's fee splits the same way", () => {
    const q = quoteSell({ yesReserve: 8_313_962n, noReserve: 12_027_961n }, OUTCOME.Yes, 6_627_759n, 100n)!;
    const s = splitTradeFee(q.fee, V3)!;
    expect(s).toEqual({ creator: 10_137n, agent: 6_758n, payee: 16_897n });
  });
  test("legacy: by the governable bps of the trade", () => {
    expect(splitTradeFee(14_000n, LEGACY)).toEqual({ creator: 4_000n, agent: 3_000n, payee: 7_000n });
  });
});

describe("void refund mirror (net cost is already net of fees)", () => {
  test("covered pool: every trader gets their net cost back in full", () => {
    // 5 USDC seed; a 2 USDC buy nets 1.98 into the pot and into the buyer's net cost.
    const v = mirrorVoid(6_980_000n, 1_980_000n);
    expect(v).toEqual({ voidTraderPool: 1_980_000n, voidNetCostTotal: 1_980_000n, lpPot: 5_000_000n });
    expect(voidRefund(1_980_000n, v.voidTraderPool, v.voidNetCostTotal)).toBe(1_980_000n);
    expect(voidIsProRata(v.voidTraderPool, v.voidNetCostTotal)).toBe(false);
  });
  test("pro rata when the pot is smaller than the outstanding net cost", () => {
    const v = mirrorVoid(8_000_000n, 10_000_000n);
    expect(v).toEqual({ voidTraderPool: 8_000_000n, voidNetCostTotal: 10_000_000n, lpPot: 0n });
    expect(voidIsProRata(v.voidTraderPool, v.voidNetCostTotal)).toBe(true);
    const a = voidRefund(4_000_000n, v.voidTraderPool, v.voidNetCostTotal);
    const b = voidRefund(6_000_000n, v.voidTraderPool, v.voidNetCostTotal);
    expect([a, b]).toEqual([3_200_000n, 4_800_000n]);
    expect(a + b).toBeLessThanOrEqual(v.voidTraderPool);
  });
  test("floors each refund; nothing owed pays nothing", () => {
    expect(voidRefund(3n, 2n, 3n)).toBe(2n);
    expect(voidRefund(1n, 1n, 3n)).toBe(0n);
    expect(voidRefund(5n, 0n, 0n)).toBe(0n);
  });
  test("preview copy", () => {
    expect(voidRefundText(1_980_000n, 1_980_000n)).toBe("your net cost $1.98 back = $1.98");
    expect(voidRefundText(4_000_000n, 3_200_000n, true)).toContain("pro rata");
  });
});

describe("mirrorRedeem / mirrorClaimLP", () => {
  const holder = { yes: 3_398_338n, no: 10n, lp: 0n, netCost: 1_980_000n };
  const base = { yesWon: true, lpPot: 3_581_662n, totalLpShares: 5_000_000n };
  test("trading pays nothing", () => {
    expect(mirrorRedeem({ ...base, phase: PHASE.Trading }, holder, V3)).toBe(0n);
    expect(mirrorClaimLP({ ...base, phase: PHASE.Trading }, { lp: 5n })).toBe(0n);
  });
  test("resolved: winners 1:1 again; LP pot = winning reserve", () => {
    const s = { ...base, phase: PHASE.Resolved };
    expect(mirrorRedeem(s, holder, V3)).toBe(3_398_338n);
    expect(mirrorRedeem({ ...s, yesWon: false }, holder, V3)).toBe(10n);
    expect(mirrorClaimLP(s, { lp: 5_000_000n })).toBe(3_581_662n);
    expect(lpClaimPayout(2_500_000n, 3_581_662n, 5_000_000n)).toBe(1_790_831n);
  });
  test("v3 voided refunds net cost, ignoring which side was held", () => {
    const s = { ...base, phase: PHASE.Voided, voidTraderPool: 1_980_000n, voidNetCostTotal: 1_980_000n };
    expect(mirrorRedeem(s, holder, V3)).toBe(1_980_000n);
  });
  test("v3 void without the snapshot or net cost is undefined (UI then relies on the view)", () => {
    expect(mirrorRedeem({ ...base, phase: PHASE.Voided }, holder, V3)).toBeUndefined();
    expect(mirrorRedeem({ ...base, phase: PHASE.Voided, voidTraderPool: 1n, voidNetCostTotal: 1n }, { ...holder, netCost: undefined }, V3)).toBeUndefined();
  });
  test("legacy keeps $0.50 voids", () => {
    expect(mirrorRedeem({ ...base, phase: PHASE.Voided }, { yes: 3n, no: 1n, lp: 0n }, LEGACY)).toBe(2n);
  });
});

describe("status and rule copy follow the fee model", () => {
  const live = { expiry: 1_000n, chainNow: 2_000n, supportsSettlement: true, settlement: undefined };
  test("void copy: net cost back; the agent's held 20% to its successful challenger", () => {
    const v = marketStatus({ ...live, phase: PHASE.Voided, feeModel: V3 });
    expect(v.detail).toContain("net cost back");
    expect(v.detail).toContain("held 20% goes to its successful challenger (otherwise to the season pool)");
    expect(v.detail).not.toMatch(/\$0\.50|minus 1%/);
    const vv = marketStatus({ ...live, phase: 0, settlement: SETTLEMENT.Voidable, feeModel: V3 });
    expect(vv.detail).toContain("net cost back");
  });
  test("resolved pays $1.00 per winning share", () => {
    expect(marketStatus({ ...live, phase: PHASE.Resolved, yesWon: true, feeModel: V3 }).detail).toContain("$1.00");
  });
  test("rule text", () => {
    const t = settlementRuleText(86_400, V3);
    expect(t).toContain("net cost back (what they put in after fees, minus what they took out)");
    expect(t).toContain("held 20% goes to whoever successfully challenged");
    expect(t).not.toContain("$0.50");
    expect(t).toContain("otherwise to the season pool");
    expect(settlementRuleText(86_400, PRE_FUND)).toContain("otherwise to the builder commons");
    expect(settlementRuleText(86_400, V4)).toContain("otherwise to the Registrai treasury");
    expect(settlementRuleText(86_400, LEGACY)).toContain("$0.50");
  });
});
