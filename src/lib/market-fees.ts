/**
 * Fee & settlement model v3, shared by MarketsPerennial and MarketsV4 — pure.
 *
 *  - A 1% TRADING fee on every buy (on collateralIn) and every sell (on the
 *    curve's grossOut). Nothing is charged at settlement.
 *  - Each fee splits 30% creator · 20% agent · 50% payee. The payee is the
 *    builder the market is about on MarketsPerennial (credited as that
 *    builder's income in the BuilderFund, taxed progressively per epoch — see
 *    builder-economy.ts) and the Registrai treasury on MarketsV4. Creator and
 *    payee are paid on the trade; the agent's 20% is held per market
 *    (agentEscrow) until settlement.
 *  - Resolved: winners redeem 1 per winning share; the escrow goes to the agent.
 *  - Voided: each trader redeems netCost * voidTraderPool / voidNetCostTotal
 *    (floor) — their net cost (already net of fees), pro rata only when the
 *    pool is short. The escrow goes to the successful challenger, else to the
 *    season pool (MarketsPerennial) / the treasury (MarketsV4).
 *
 * Deployed contracts differ by network (a MarketsPerennial from before the
 * BuilderFund paid its 50% into a progress commons; older ones charge 70 bps
 * with a different split and $0.50 voids), so every consumer takes a FeeModel
 * that the chain layer probes.
 */
import { BPS, PHASE, bpsPct, formatUsdc, redeemPayout } from "./perennial-market";
import { PAYEE, type PayeeKind } from "./fee-payee";

/** The constants the contracts fix in code (used when a share read is absent). */
export const TRADE_FEE_DEFAULTS = {
  tradeFeeBps: 100n,
  creatorShareBps: 3_000n,
  agentShareBps: 2_000n,
  payeeShareBps: 5_000n,
} as const;

export type FeeFlavor = "perennial" | "v4";
export { PAYEE, type PayeeKind };

export type FeeModel =
  | {
      /** v3: TRADE_FEE_BPS on every trade; shares are bps OF THE FEE. */
      kind: "trade";
      tradeFeeBps: bigint;
      creatorShareBps: bigint;
      agentShareBps: bigint;
      payeeShareBps: bigint;
      payee: PayeeKind;
    }
  | {
      /** Legacy contract: FEE_BPS_TOTAL per trade; split in bps OF THE TRADE. */
      kind: "legacy";
      tradeFeeBps: bigint;
      /** Absent when any leg is unreadable. */
      split?: { creatorBps: bigint; agentBps: bigint; payeeBps: bigint };
      payee: PayeeKind;
    }
  | { kind: "unknown" };

/** The fee a trade pays, or undefined when it can't be known (no quote then). */
export function tradeFeeBps(m: FeeModel | undefined): bigint | undefined {
  if (!m || m.kind === "unknown") return undefined;
  return m.tradeFeeBps;
}

// ───────────────────────────── probing ─────────────────────────────

export interface FeeProbe {
  /** TRADE_FEE_BPS + shares; null when TRADE_FEE_BPS reverted. `commonsLeg`:
   *  a MarketsPerennial that answered COMMONS_SHARE_BPS, not BUILDER_SHARE_BPS
   *  (deployed before the BuilderFund). */
  v3: { feeBps: bigint; creator?: bigint; agent?: bigint; payee?: bigint; commonsLeg?: boolean } | null;
  /** Legacy reads; null when FEE_BPS_TOTAL reverted too (or wasn't tried). */
  legacy: { totalBps: bigint; creator?: bigint; agent?: bigint; payee?: bigint } | null;
}

/** Capability fallback: v3 when TRADE_FEE_BPS answers, else the legacy fee when
 *  FEE_BPS_TOTAL answers, else unknown (fee detail hidden, no quote). */
export function feeModelFromProbe(p: FeeProbe, flavor: FeeFlavor): FeeModel {
  if (p.v3) {
    const d = TRADE_FEE_DEFAULTS;
    return {
      kind: "trade",
      tradeFeeBps: p.v3.feeBps,
      creatorShareBps: p.v3.creator ?? d.creatorShareBps,
      agentShareBps: p.v3.agent ?? d.agentShareBps,
      payeeShareBps: p.v3.payee ?? d.payeeShareBps,
      payee: flavor === "v4" ? "treasury" : p.v3.commonsLeg ? "commons" : "builder",
    };
  }
  if (p.legacy) {
    const { creator, agent, payee } = p.legacy;
    return {
      kind: "legacy",
      tradeFeeBps: p.legacy.totalBps,
      split:
        creator !== undefined && agent !== undefined && payee !== undefined
          ? { creatorBps: creator, agentBps: agent, payeeBps: payee }
          : undefined,
      payee: flavor === "v4" ? "treasury" : "commons",
    };
  }
  return { kind: "unknown" };
}

// ───────────────────────────── fee split ─────────────────────────────

export interface FeeLegs {
  creator: bigint;
  /** v3: added to the market's agentEscrow. */
  agent: bigint;
  /** The builder the market is about (Perennial), the treasury (V4). */
  payee: bigint;
}

/**
 * Split one trade's fee exactly like the contract. v3: creator and agent floor
 * their share of the fee, the payee takes the remainder. Legacy: by the
 * governable bps of the trade (creator/agent floor, remainder to the payee).
 */
export function splitTradeFee(fee: bigint, m: FeeModel | undefined): FeeLegs | undefined {
  if (!m || m.kind === "unknown") return undefined;
  if (m.kind === "trade") {
    const creator = (fee * m.creatorShareBps) / BPS;
    const agent = (fee * m.agentShareBps) / BPS;
    return { creator, agent, payee: fee - creator - agent };
  }
  if (!m.split) return undefined;
  const total = m.split.creatorBps + m.split.agentBps + m.split.payeeBps;
  if (total === 0n) return { creator: 0n, agent: 0n, payee: fee };
  const creator = (fee * m.split.creatorBps) / total;
  const agent = (fee * m.split.agentBps) / total;
  return { creator, agent, payee: fee - creator - agent };
}

/** The label of the 50% leg ("builder (income, taxed per epoch)", "Registrai treasury", ...). */
export function payeeLabel(m: FeeModel | undefined): string | undefined {
  return !m || m.kind === "unknown" ? undefined : PAYEE[m.payee].label;
}

/** Short label for the ticket's fee legs: "builder" / "commons" / "treasury". */
export function payeeShort(m: FeeModel | undefined): string | undefined {
  return !m || m.kind === "unknown" ? undefined : PAYEE[m.payee].short;
}

/** Where an unchallenged void's agent escrow goes: "season pool", "Registrai treasury", ... */
export function voidSinkLabel(m: FeeModel | undefined): string | undefined {
  return !m || m.kind === "unknown" ? undefined : PAYEE[m.payee].voidSink;
}

// ───────────────────────────── display ─────────────────────────────

/** "1% trading fee · 30% creator · 20% agent (held until settlement) · 50% builder (income, taxed per epoch)". */
export function feeSummary(m: FeeModel | undefined): string | undefined {
  if (!m || m.kind === "unknown") return undefined;
  const label = PAYEE[m.payee].label;
  if (m.kind === "trade") {
    const pre = m.payee === "commons" ? " (contract from before the BuilderFund)" : "";
    return (
      `${bpsPct(m.tradeFeeBps)} trading fee · ${bpsPct(m.creatorShareBps)} creator · ` +
      `${bpsPct(m.agentShareBps)} agent (held until settlement) · ${bpsPct(m.payeeShareBps)} ${label}${pre}`
    );
  }
  const head = `${bpsPct(m.tradeFeeBps)} trading fee (legacy contract)`;
  if (!m.split) return head;
  return `${head} · creator ${bpsPct(m.split.creatorBps)} · agent ${bpsPct(m.split.agentBps)} · ${label} ${bpsPct(m.split.payeeBps)} of each trade`;
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
