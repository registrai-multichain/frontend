/**
 * Fee & settlement model v2, shared by MarketsPerennial and MarketsV4 — pure.
 *
 *  - Trades carry NO fee.
 *  - At settlement a 1% resolution fee is charged once on the market's pot C:
 *    30% creator · 20% agent · 50% commons (MarketsV4: Registrai treasury).
 *  - Resolved: winners redeem shares * settledNet / settledGross (floor).
 *  - Voided: each trader redeems netCost * voidTraderPool / voidNetCostTotal
 *    (floor) — their net cost minus 1%, pro rata only in the rare case earlier
 *    sellers took out more than the LP seed. The agent's 20% goes to whoever
 *    successfully challenged its answer, else to the commons / treasury.
 *
 * Testnet still runs the legacy contracts (a per-trade fee, no resolution fee),
 * so every consumer takes a FeeModel that the chain layer probes for, and the
 * legacy payout mirrors are kept alongside the new ones.
 */
import { BPS, PHASE, bpsPct, formatUsdc, redeemPayout } from "./perennial-market";

/** The constants the contracts fix in code (used when a share read is absent). */
export const RESOLUTION_FEE_DEFAULTS = {
  resolutionFeeBps: 100n,
  creatorShareBps: 3_000n,
  agentShareBps: 2_000n,
  commonsShareBps: 5_000n,
} as const;

/** Where the 50% leg goes: the builder commons (Perennial) or the treasury (V4). */
export const COMMONS_LABEL = {
  perennial: "builder commons",
  v4: "Registrai treasury",
} as const;
export type FeeFlavor = keyof typeof COMMONS_LABEL;

export type FeeModel =
  | {
      /** v2: no trading fee; 1% once at settlement, split of the fee in bps. */
      kind: "resolution";
      resolutionFeeBps: bigint;
      creatorShareBps: bigint;
      agentShareBps: bigint;
      commonsShareBps: bigint;
      commonsLabel: string;
    }
  | {
      /** Legacy contract: a fee on every trade (bps of the trade). */
      kind: "legacy";
      tradeFeeBps: bigint;
      /** Legacy split in bps of the trade; absent when unreadable. */
      split?: { creatorBps: bigint; agentBps: bigint; commonsBps: bigint };
      commonsLabel: string;
    }
  | { kind: "unknown" };

/** The fee a trade pays on this contract, or undefined when it can't be known
 *  (then no exact quote can be given and trading waits). */
export function tradeFeeBps(m: FeeModel | undefined): bigint | undefined {
  if (!m) return undefined;
  if (m.kind === "resolution") return 0n;
  if (m.kind === "legacy") return m.tradeFeeBps;
  return undefined;
}

// ───────────────────────────── probing ─────────────────────────────

export interface FeeProbe {
  /** RESOLUTION_FEE_BPS + shares; null when RESOLUTION_FEE_BPS reverted. */
  resolution: { feeBps: bigint; creator?: bigint; agent?: bigint; commons?: bigint } | null;
  /** Legacy reads; null when FEE_BPS_TOTAL reverted too (or wasn't tried). */
  legacy: { totalBps: bigint; creator?: bigint; agent?: bigint; commons?: bigint } | null;
}

/** Capability fallback: v2 when RESOLUTION_FEE_BPS answers, else the legacy
 *  per-trade fee when that answers, else unknown (fee detail hidden). */
export function feeModelFromProbe(p: FeeProbe, flavor: FeeFlavor): FeeModel {
  const commonsLabel = COMMONS_LABEL[flavor];
  if (p.resolution) {
    const d = RESOLUTION_FEE_DEFAULTS;
    return {
      kind: "resolution",
      resolutionFeeBps: p.resolution.feeBps,
      creatorShareBps: p.resolution.creator ?? d.creatorShareBps,
      agentShareBps: p.resolution.agent ?? d.agentShareBps,
      commonsShareBps: p.resolution.commons ?? d.commonsShareBps,
      commonsLabel,
    };
  }
  if (p.legacy) {
    const { creator, agent, commons } = p.legacy;
    return {
      kind: "legacy",
      tradeFeeBps: p.legacy.totalBps,
      split:
        creator !== undefined && agent !== undefined && commons !== undefined
          ? { creatorBps: creator, agentBps: agent, commonsBps: commons }
          : undefined,
      commonsLabel,
    };
  }
  return { kind: "unknown" };
}

// ───────────────────────────── display ─────────────────────────────

/** "1% at settlement · 30% creator · 20% agent · 50% builder commons". */
export function feeSummary(m: FeeModel | undefined): string | undefined {
  if (!m || m.kind === "unknown") return undefined;
  if (m.kind === "resolution") {
    return (
      `${bpsPct(m.resolutionFeeBps)} at settlement · ${bpsPct(m.creatorShareBps)} creator · ` +
      `${bpsPct(m.agentShareBps)} agent · ${bpsPct(m.commonsShareBps)} ${m.commonsLabel}`
    );
  }
  const head = `${bpsPct(m.tradeFeeBps)} per trade`;
  if (!m.split) return head;
  return `${head} · creator ${bpsPct(m.split.creatorBps)} · agent ${bpsPct(m.split.agentBps)} · ${m.commonsLabel} ${bpsPct(m.split.commonsBps)}`;
}

/** The fee line on an order ticket. */
export function ticketFeeLabel(m: FeeModel | undefined): string {
  if (!m || m.kind === "unknown") return "fee unavailable";
  if (m.kind === "resolution") return `no trading fee — ${bpsPct(m.resolutionFeeBps)} at settlement`;
  return `${bpsPct(m.tradeFeeBps)} per trade`;
}

/** Short stat, e.g. "1% at settlement" / "0.7% per trade". */
export function feeHeadline(m: FeeModel | undefined): string | undefined {
  if (!m || m.kind === "unknown") return undefined;
  return m.kind === "resolution" ? `${bpsPct(m.resolutionFeeBps)} at settlement` : `${bpsPct(m.tradeFeeBps)} per trade`;
}

// ───────────────────────────── settlement mirrors ─────────────────────────────

/** The fee charged once on a pot C, split exactly like the contract:
 *  creator and agent floor, commons takes the remainder. */
export function splitResolutionFee(
  collateral: bigint,
  m: Pick<Extract<FeeModel, { kind: "resolution" }>, "resolutionFeeBps" | "creatorShareBps" | "agentShareBps">,
) {
  const fee = (collateral * m.resolutionFeeBps) / BPS;
  const creator = (fee * m.creatorShareBps) / BPS;
  const agent = (fee * m.agentShareBps) / BPS;
  return { fee, creator, agent, commons: fee - creator - agent };
}

/** resolve(): settledGross = C, settledNet = C − F. */
export function mirrorResolve(collateral: bigint, feeBps: bigint) {
  const fee = (collateral * feeBps) / BPS;
  return { settledGross: collateral, settledNet: collateral - fee, fee };
}

/** voidMarket(): traderPool = min(totalNetCost·(1 − fee), C − F); LP pot = rest. */
export function mirrorVoid(collateral: bigint, totalNetCost: bigint, feeBps: bigint) {
  const fee = (collateral * feeBps) / BPS;
  const avail = collateral - fee;
  const owed = (totalNetCost * (BPS - feeBps)) / BPS;
  const voidTraderPool = owed < avail ? owed : avail;
  return { fee, avail, voidTraderPool, voidNetCostTotal: totalNetCost, lpPot: avail - voidTraderPool };
}

/** A winner's redemption: shares * settledNet / settledGross (floor). */
export function resolvedPayout(winningShares: bigint, settledNet: bigint, settledGross: bigint): bigint {
  if (settledGross === 0n) return 0n;
  return (winningShares * settledNet) / settledGross;
}

/** A trader's void refund: netCost * voidTraderPool / voidNetCostTotal (floor). */
export function voidRefund(netCost: bigint, voidTraderPool: bigint, voidNetCostTotal: bigint): bigint {
  if (voidNetCostTotal === 0n) return 0n;
  return (netCost * voidTraderPool) / voidNetCostTotal;
}

/** Net cost minus the resolution fee — the void refund when the pool covers it. */
export function netCostMinusFee(netCost: bigint, feeBps: bigint): bigint {
  return (netCost * (BPS - feeBps)) / BPS;
}

/** True when the void pool could not cover net cost minus the fee in full
 *  (earlier sellers took out more than the LP seed): refunds are pro rata. */
export function voidIsProRata(voidTraderPool: bigint, voidNetCostTotal: bigint, feeBps: bigint): boolean {
  return voidTraderPool < netCostMinusFee(voidNetCostTotal, feeBps);
}

/** claimLP(): lpShares * lpPot / totalLpShares (floor). */
export function lpClaimPayout(lpShares: bigint, lpPot: bigint, totalLpShares: bigint): bigint {
  if (totalLpShares === 0n) return 0n;
  return (lpShares * lpPot) / totalLpShares;
}

export interface SettlementSnapshot {
  phase: number;
  yesWon: boolean;
  settledNet?: bigint;
  settledGross?: bigint;
  voidTraderPool?: bigint;
  voidNetCostTotal?: bigint;
  /** lpPotAtResolution */
  lpPot: bigint;
  totalLpShares: bigint;
}
export interface Holding {
  yes: bigint;
  no: bigint;
  lp: bigint;
  netCost?: bigint;
}

/**
 * What redeem() would pay this holder now, derived locally. Undefined when the
 * v2 inputs it needs were not read (the UI then relies on the `redeemable` view).
 */
export function mirrorRedeem(s: SettlementSnapshot, h: Holding, m: FeeModel | undefined): bigint | undefined {
  if (s.phase === PHASE.Trading) return 0n;
  if (m?.kind === "resolution") {
    if (s.phase === PHASE.Resolved) {
      if (s.settledNet === undefined || s.settledGross === undefined) return undefined;
      return resolvedPayout(s.yesWon ? h.yes : h.no, s.settledNet, s.settledGross);
    }
    if (s.phase === PHASE.Voided) {
      if (h.netCost === undefined || s.voidTraderPool === undefined || s.voidNetCostTotal === undefined) return undefined;
      return voidRefund(h.netCost, s.voidTraderPool, s.voidNetCostTotal);
    }
    return undefined;
  }
  // Legacy contracts: winners 1:1, a void pays $0.50 per share of either side.
  return redeemPayout(s, h.yes, h.no);
}

/** What claimLP() would pay this holder now. */
export function mirrorClaimLP(s: SettlementSnapshot, h: Pick<Holding, "lp">): bigint {
  if (s.phase === PHASE.Trading) return 0n;
  return lpClaimPayout(h.lp, s.lpPot, s.totalLpShares);
}

/** "your net cost $X minus 1% = $Y" (+ a pro-rata note when it applies). */
export function voidRefundText(netCost: bigint, refund: bigint, feeBps: bigint, proRata = false): string {
  const base = `your net cost $${formatUsdc(netCost)} minus ${bpsPct(feeBps)} = $${formatUsdc(refund)}`;
  return proRata ? `${base} (pro rata: earlier sellers took out more than the LP seed)` : base;
}
