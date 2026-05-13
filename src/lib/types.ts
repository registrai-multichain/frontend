export interface Feed {
  id: `0x${string}`;
  symbol: string;
  description: string;
  unit: string;
  methodologyCid: string;
  minBond: number; // USDC, human units
  disputeWindowSec: number;
  resolver: `0x${string}`;
  resolverLabel: string;
  agents: Agent[];
}

export interface Agent {
  address: `0x${string}`;
  bond: number;
  registeredAt: number;
  attestations: Attestation[];
}

export interface Attestation {
  id: `0x${string}`;
  value: number;
  timestamp: number;
  finalizedAt: number;
  status: "none" | "pending" | "valid" | "invalid";
  inputHash: `0x${string}`;
}

export type Comparator = ">" | ">=" | "<" | "<=";
export type MarketPhase = "trading" | "resolved";

export interface Market {
  id: `0x${string}`;
  feedId: `0x${string}`;
  feedSymbol: string;
  agent: `0x${string}`;
  threshold: number;
  comparator: Comparator;
  expiry: number; // unix seconds
  creator: `0x${string}`;
  /** Pool reserves, in USDC micro-units (for consistency with chain numbers). */
  yesReserve: number;
  noReserve: number;
  /** Total USDC currently in the market contract for this market. */
  liquidity: number;
  phase: MarketPhase;
  yesWon?: boolean;
  resolvedValue?: number;
  /** Recent trades for the chart. */
  history: MarketTrade[];
  /** Human-readable label generated from threshold + comparator + feed. */
  title: string;
  unit: string;
  /** Lifetime fee totals for this market, in collateral micro-units. */
  fees?: MarketFees;
}

export interface MarketFees {
  creator: number;
  agent: number;
  treasury: number;
  grossVolume: number;
}

export interface MarketTrade {
  ts: number;
  yesPrice: number; // 0..1
  side: "yes" | "no";
  collateral: number; // USDC
}
