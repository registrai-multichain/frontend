/**
 * Fee & settlement model v3, shared by MarketsPerennial and MarketsV4 — pure.
 *
 *  - A 1% TRADING fee on every buy (on collateralIn) and every sell (on the
 *    curve's grossOut). Nothing is charged at settlement.
 *  - Each fee splits 30% creator · 20% agent · 50% commons (MarketsV4:
 *    Registrai treasury). Creator and commons are paid on the trade; the
 *    agent's 20% is held per market (agentEscrow) until settlement.
 *  - Resolved: winners redeem 1 per winning share; the escrow goes to the agent.
 *  - Voided: each trader redeems netCost * voidTraderPool / voidNetCostTotal
 *    (floor) — their net cost (already net of fees), pro rata only when the
 *    pool is short. The escrow goes to the successful challenger, else to the
 *    commons / treasury.
 *
 * Testnet still runs the legacy contracts (70 bps per trade, a different split,
 * $0.50 voids), so every consumer takes a FeeModel that the chain layer probes.
 */
import { BPS, PHASE, bpsPct, formatUsdc, redeemPayout } from "./perennial-market";

/** The constants the contracts fix in code (used when a share read is absent). */
export const TRADE_FEE_DEFAULTS = {
  tradeFeeBps: 100n,
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
      /** v3: TRADE_FEE_BPS on every trade; shares are bps OF THE FEE. */
      kind: "trade";
      tradeFeeBps: bigint;
      creatorShareBps: bigint;
      agentShareBps: bigint;
      commonsShareBps: bigint;
      commonsLabel: string;
    }
  | {
      /** Legacy contract: FEE_BPS_TOTAL per trade; split in bps OF THE TRADE. */
      kind: "legacy";
      tradeFeeBps: bigint;
      /** Absent when any leg is unreadable. */
      split?: { creatorBps: bigint; agentBps: bigint; commonsBps: bigint };
      commonsLabel: string;
    }
  | { kind: "unknown" };

/** The fee a trade pays, or undefined when it can't be known (no quote then). */
export function tradeFeeBps(m: FeeModel | undefined): bigint | undefined {
  if (!m || m.kind === "unknown") return undefined;
  return m.tradeFeeBps;
}

// ───────────────────────────── probing ─────────────────────────────

export interface FeeProbe {
  /** TRADE_FEE_BPS + shares; null when TRADE_FEE_BPS reverted. */
  v3: { feeBps: bigint; creator?: bigint; agent?: bigint; commons?: bigint } | null;
  /** Legacy reads; null when FEE_BPS_TOTAL reverted too (or wasn't tried). */
  legacy: { totalBps: bigint; creator?: bigint; agent?: bigint; commons?: bigint } | null;
}

/** Capability fallback: v3 when TRADE_FEE_BPS answers, else the legacy fee when
 *  FEE_BPS_TOTAL answers, else unknown (fee detail hidden, no quote). */
export function feeModelFromProbe(p: FeeProbe, flavor: FeeFlavor): FeeModel {
  const commonsLabel = COMMONS_LABEL[flavor];
  if (p.v3) {
    const d = TRADE_FEE_DEFAULTS;
    return {
      kind: "trade",
      tradeFeeBps: p.v3.feeBps,
      creatorShareBps: p.v3.creator ?? d.creatorShareBps,
      agentShareBps: p.v3.agent ?? d.agentShareBps,
      commonsShareBps: p.v3.commons ?? d.commonsShareBps,
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

// ───────────────────────────── fee split ─────────────────────────────

export interface FeeLegs {
  creator: bigint;
  /** v3: added to the market's agentEscrow. */
  agent: bigint;
  commons: bigint;
}

/**
 * Split one trade's fee exactly like the contract. v3: creator and agent floor
 * their share of the fee, commons takes the remainder. Legacy: by the governable
 * bps of the trade (creator/agent floor, remainder to commons).
 */
export function splitTradeFee(fee: bigint, m: FeeModel | undefined): FeeLegs | undefined {
  if (!m || m.kind === "unknown") return undefined;
  if (m.kind === "trade") {
    const creator = (fee * m.creatorShareBps) / BPS;
    const agent = (fee * m.agentShareBps) / BPS;
    return { creator, agent, commons: fee - creator - agent };
  }
  if (!m.split) return undefined;
  const total = m.split.creatorBps + m.split.agentBps + m.split.commonsBps;
  if (total === 0n) return { creator: 0n, agent: 0n, commons: fee };
  const creator = (fee * m.split.creatorBps) / total;
  const agent = (fee * m.split.agentBps) / total;
  return { creator, agent, commons: fee - creator - agent };
}

// ───────────────────────────── display ─────────────────────────────

/** "1% trading fee · 30% creator · 20% agent (held until settlement) · 50% builder commons". */
export function feeSummary(m: FeeModel | undefined): string | undefined {
  if (!m || m.kind === "unknown") return undefined;
  if (m.kind === "trade") {
    return (
      `${bpsPct(m.tradeFeeBps)} trading fee · ${bpsPct(m.creatorShareBps)} creator · ` +
      `${bpsPct(m.agentShareBps)} agent (held until settlement) · ${bpsPct(m.commonsShareBps)} ${m.commonsLabel}`
    );
  }
  const head = `${bpsPct(m.tradeFeeBps)} trading fee (legacy contract)`;
  if (!m.split) return head;
  return `${head} · creator ${bpsPct(m.split.creatorBps)} · agent ${bpsPct(m.split.agentBps)} · ${m.commonsLabel} ${bpsPct(m.split.commonsBps)} of each trade`;
}

/** Short stat, e.g. "1% per trade". */
export function feeHeadline(m: FeeModel | undefined): string | undefined {
  if (!m || m.kind === "unknown") return undefined;
  return `${bpsPct(m.tradeFeeBps)} per trade`;
}

// ───────────────────────────── settlement mirrors ─────────────────────────────

/** voidMarket(): traderPool = min(totalNetCost, C); LP pot = C − traderPool. */
export function mirrorVoid(collateral: bigint, totalNetCost: bigint) {
  const voidTraderPool = totalNetCost < collateral ? totalNetCost : collateral;
  return { voidTraderPool, voidNetCostTotal: totalNetCost, lpPot: collateral - voidTraderPool };
}

/** A trader's void refund: netCost * voidTraderPool / voidNetCostTotal (floor). */
export function voidRefund(netCost: bigint, voidTraderPool: bigint, voidNetCostTotal: bigint): bigint {
  if (voidNetCostTotal === 0n) return 0n;
  return (netCost * voidTraderPool) / voidNetCostTotal;
}

/** True when the void pool could not cover every trader's net cost in full. */
export function voidIsProRata(voidTraderPool: bigint, voidNetCostTotal: bigint): boolean {
  return voidTraderPool < voidNetCostTotal;
}

/** claimLP(): lpShares * lpPot / totalLpShares (floor). */
export function lpClaimPayout(lpShares: bigint, lpPot: bigint, totalLpShares: bigint): bigint {
  if (totalLpShares === 0n) return 0n;
  return (lpShares * lpPot) / totalLpShares;
}

export interface SettlementSnapshot {
  phase: number;
  yesWon: boolean;
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
 * What redeem() would pay this holder now, derived locally. Undefined when a v3
 * void's inputs were not read (the UI then relies on the `redeemable` view).
 */
export function mirrorRedeem(s: SettlementSnapshot, h: Holding, m: FeeModel | undefined): bigint | undefined {
  if (s.phase === PHASE.Trading) return 0n;
  if (m?.kind === "trade" && s.phase === PHASE.Voided) {
    if (h.netCost === undefined || s.voidTraderPool === undefined || s.voidNetCostTotal === undefined) return undefined;
    return voidRefund(h.netCost, s.voidTraderPool, s.voidNetCostTotal);
  }
  // Resolved (v3 and legacy): winners 1:1. Legacy void: $0.50 per share.
  return redeemPayout(s, h.yes, h.no);
}

/** What claimLP() would pay this holder now. */
export function mirrorClaimLP(s: SettlementSnapshot, h: Pick<Holding, "lp">): bigint {
  if (s.phase === PHASE.Trading) return 0n;
  return lpClaimPayout(h.lp, s.lpPot, s.totalLpShares);
}

/** Void preview: "your net cost $X back" or, when the pool is short, the pro-rata share. */
export function voidRefundText(netCost: bigint, refund: bigint, proRata = false): string {
  if (!proRata) return `your net cost $${formatUsdc(netCost)} back = $${formatUsdc(refund)}`;
  return `your net cost $${formatUsdc(netCost)}, pro rata (the pool is short) = $${formatUsdc(refund)}`;
}
