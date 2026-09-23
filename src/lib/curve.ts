/**
 * Client-side mirror of CurveMarket's bucketing kernel.
 *
 * Every function here reproduces the Solidity exactly, including the
 * round-half-up tie-break. If these ever disagree, the UI is lying about where
 * a stake lands — so they are covered by a test that cross-checks against the
 * contract.
 */
import type { Address } from "viem";
import { ARC_TESTNET } from "./chains";

export const VALUE_SCALE = 1_000_000;

export const curveMarketAbi = [
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "bucket", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "bucket", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "list",
    stateMutability: "nonpayable",
    inputs: [
      { name: "listingId", type: "bytes32" },
      { name: "marketId", type: "bytes32" },
      { name: "bucket", type: "uint8" },
      { name: "stakeAmount", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelListing",
    stateMutability: "nonpayable",
    inputs: [{ name: "listingId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "buyListing",
    stateMutability: "nonpayable",
    inputs: [{ name: "listingId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "bucket", type: "uint8" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "stakeOf",
    stateMutability: "view",
    inputs: [
      { name: "", type: "bytes32" },
      { name: "", type: "uint8" },
      { name: "", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "bucketStakes",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [{ type: "uint256[41]" }],
  },
  {
    type: "function",
    name: "previewPayout",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "bytes32" },
      { name: "bucket", type: "uint8" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getMarket",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [
      { name: "status", type: "uint8" },
      { name: "bucketCount", type: "uint8" },
      { name: "winningBucket", type: "uint8" },
      { name: "totalStaked", type: "uint256" },
      { name: "payoutPool", type: "uint256" },
      { name: "opensAt", type: "uint64" },
      { name: "closesAt", type: "uint64" },
      { name: "resolveAfter", type: "uint64" },
      { name: "normalizedOutcome", type: "int256" },
    ],
  },
] as const;

/** Mirrors CurveMarket.bucketForValue — round-half-up, ties to the higher bucket. */
export function bucketForValue(normalized: number, bucketCount: number): number {
  const clamped = Math.max(-VALUE_SCALE, Math.min(VALUE_SCALE, Math.round(normalized)));
  const shifted = clamped + VALUE_SCALE;
  const intervals = bucketCount - 1;
  const span = VALUE_SCALE * 2;
  return Math.floor((shifted * intervals + span / 2) / span);
}

/** Mirrors CurveMarket.weightOf — full support, linear falloff. */
export function weightOf(bucket: number, winner: number, bucketCount: number): number {
  return bucketCount - Math.abs(bucket - winner);
}

/**
 * Map a BTC price to the normalized [-1, 1] range used by the contract.
 * `band` is the fractional move that saturates the range, e.g. 0.004 = ±0.4%.
 */
export function priceToNormalized(price: number, strike: number, band: number): number {
  const rel = (price - strike) / (strike * band);
  return Math.max(-VALUE_SCALE, Math.min(VALUE_SCALE, Math.round(rel * VALUE_SCALE)));
}

export function normalizedToPrice(normalized: number, strike: number, band: number): number {
  return strike + (normalized / VALUE_SCALE) * strike * band;
}

/** Inclusive price bounds of a bucket, for axis labels. */
export function bucketPriceRange(
  bucket: number,
  bucketCount: number,
  strike: number,
  band: number,
): { lo: number; hi: number; mid: number } {
  const span = (VALUE_SCALE * 2) / (bucketCount - 1);
  const centre = -VALUE_SCALE + bucket * span;
  return {
    lo: normalizedToPrice(centre - span / 2, strike, band),
    hi: normalizedToPrice(centre + span / 2, strike, band),
    mid: normalizedToPrice(centre, strike, band),
  };
}

/**
 * What a stake would pay if `winner` came in, given current pool state.
 * Mirrors the contract's split: accuracy pool by stake*weight, plus a
 * leverage-capped jackpot for the exact bucket.
 */
export function projectPayout(params: {
  bucketStakes: bigint[];
  bucketCount: number;
  myBucket: number;
  myStake: bigint;
  winner: number;
  feeBps: number;
  jackpotBps: number;
}): bigint {
  const { bucketCount, myBucket, myStake, winner, feeBps, jackpotBps } = params;
  const stakes = params.bucketStakes.slice(0, bucketCount).map((s, i) => (i === myBucket ? s + myStake : s));

  const total = stakes.reduce((a, b) => a + b, 0n);
  if (total === 0n) return 0n;

  const fee = (total * BigInt(feeBps)) / 10_000n;
  const postFee = total - fee;
  const target = (postFee * BigInt(jackpotBps)) / 10_000n;
  const exact = stakes[winner] ?? 0n;
  const leverage = BigInt(Math.min(10, bucketCount - 1));
  const ceiling = exact * leverage;
  const jackpot = target < ceiling ? target : ceiling;
  const curvePool = postFee - jackpot;

  let weighted = 0n;
  for (let b = 0; b < bucketCount; b++) {
    weighted += stakes[b] * BigInt(weightOf(b, winner, bucketCount));
  }
  if (weighted === 0n) return 0n;

  let payout = (curvePool * (myStake * BigInt(weightOf(myBucket, winner, bucketCount)))) / weighted;
  if (myBucket === winner && exact > 0n) payout += (jackpot * myStake) / exact;
  return payout;
}

export type CurveMarketConfig = {
  address: Address;
  marketId: `0x${string}`;
  label: string;
  bucketCount: number;
  band: number;
  feeBps: number;
  jackpotBps: number;
  roundSeconds: number;
};

/**
 * Live CurveMarket deployment.
 *
 * Arc testnet for now — mainnet follows once the router and gas seed are in
 * place. When `marketId` resolves on chain the UI reads real pool depth and
 * the market's own schedule; otherwise it falls back to a wall-clock preview.
 */
export const CURVE_DEPLOYMENT = {
  // Chain facts come from the chain registry (official RPC only) rather than
  // literals, so there is one place that says what "Arc testnet" means.
  chainId: ARC_TESTNET.id,
  network: "Arc testnet",
  rpcUrl: ARC_TESTNET.rpcUrls[0],
  explorer: ARC_TESTNET.explorer.url,
  address: "0xf5d0857df82f7bb26e81f59a5cc10c4ddffe2f2c" as Address,
  marketId: "0xa31c25344f6a844af0272dc1c242449b5bcc91ff98c5e05dd55ae318085e494c" as `0x${string}`,
  bucketCount: 9,
  band: 0.004,
  feeBps: 100,
  jackpotBps: 2000,
} as const;
