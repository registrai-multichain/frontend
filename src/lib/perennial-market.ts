/**
 * Pure Perennial market logic: the AMM quote (a bit-exact mirror of
 * MarketsPerennial.buy/sell — also MarketsV4, which runs the same curve),
 * settlement-state labelling, question text, and input validation. No I/O here,
 * so all of it is unit-tested. Fee split & settlement payouts: market-fees.ts.
 */
import type { FeeModel } from "./market-fees";
import { PAYEE } from "./fee-payee";

export const BPS = 10_000n;
export const USDC_DECIMALS = 6;
const ONE_USDC = 1_000_000n;

/** MarketsPerennial.Outcome — YES is 0. */
export const OUTCOME = { Yes: 0, No: 1 } as const;
export type OutcomeName = keyof typeof OUTCOME;

/** MarketsPerennial.Phase */
export const PHASE = { Trading: 0, Resolved: 1, Voided: 2 } as const;

/** SettlementPolicy.Settlement */
export const SETTLEMENT = { Open: 0, Waiting: 1, Resolvable: 2, Voidable: 3 } as const;

/** MarketsPerennial.Comparator */
export const COMPARATOR = { GreaterThan: 0, GreaterOrEqual: 1, LessThan: 2, LessOrEqual: 3 } as const;
const COMPARATOR_SYMBOL = [">", "≥", "<", "≤"] as const;

export type Reserves = { yesReserve: bigint; noReserve: bigint };

// ───────────────────────────── math helpers ─────────────────────────────

export function ceilDiv(a: bigint, b: bigint): bigint {
  return a === 0n ? 0n : (a - 1n) / b + 1n;
}

/** Floor integer square root (matches OpenZeppelin Math.sqrt). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Ceiling integer square root (matches OpenZeppelin Math.sqrt(n, Rounding.Ceil)). */
export function isqrtCeil(n: bigint): bigint {
  const r = isqrt(n);
  return r * r < n ? r + 1n : r;
}

/** Basis points as a trimmed percentage: 100 -> "1%", 3000 -> "30%", 35 -> "0.35%". */
export function bpsPct(bps: bigint): string {
  const n = Number(bps) / 100;
  return `${n.toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** Marginal price of `outcome` in 1e18 (MarketsPerennial.priceOf). */
export function priceOf(r: Reserves, outcome: number): bigint {
  const total = r.yesReserve + r.noReserve;
  if (total === 0n) return 0n;
  const other = outcome === OUTCOME.Yes ? r.noReserve : r.yesReserve;
  return (other * 10n ** 18n) / total;
}

// ───────────────────────────── quotes ─────────────────────────────

export interface BuyQuote {
  sharesOut: bigint;
  /** Trading fee: collateralIn * feeBps / 10_000 (1% on v3, 70 bps legacy). */
  fee: bigint;
  /** Average USDC paid per share, fee included, as a 0..1 number. */
  avgPrice: number;
  priceBefore: number;
  priceAfter: number;
  /** (avg price paid ex-fee − marginal price before) / marginal price before. */
  priceImpact: number;
  reservesAfter: Reserves;
}

const toNum = (wad: bigint) => Number(wad) / 1e18;

/**
 * Mirror of MarketsPerennial.buy / MarketsV4.buy: fee = collateralIn * feeBps
 * / 10_000 (floor); the rest mints complete sets and the unwanted side is
 * swapped into the pool. `feeBps` is TRADE_FEE_BPS (v3, 1%) or the legacy
 * contract's FEE_BPS_TOTAL — read from chain, never assumed.
 */
export function quoteBuy(r: Reserves, outcome: number, collateralIn: bigint, feeBps: bigint): BuyQuote | null {
  if (collateralIn <= 0n || r.yesReserve === 0n || r.noReserve === 0n) return null;
  const fee = (collateralIn * feeBps) / BPS;
  const effectiveIn = collateralIn - fee;
  const yesAfterMint = r.yesReserve + effectiveIn;
  const noAfterMint = r.noReserve + effectiveIn;
  const k = r.yesReserve * r.noReserve;
  let sharesOut: bigint;
  let after: Reserves;
  if (outcome === OUTCOME.Yes) {
    sharesOut = yesAfterMint - ceilDiv(k, noAfterMint);
    after = { yesReserve: yesAfterMint - sharesOut, noReserve: noAfterMint };
  } else {
    sharesOut = noAfterMint - ceilDiv(k, yesAfterMint);
    after = { yesReserve: yesAfterMint, noReserve: noAfterMint - sharesOut };
  }
  if (sharesOut <= 0n) return null;
  const priceBefore = toNum(priceOf(r, outcome));
  const exFeeAvg = Number(effectiveIn) / Number(sharesOut);
  return {
    sharesOut,
    fee,
    avgPrice: Number(collateralIn) / Number(sharesOut),
    priceBefore,
    priceAfter: toNum(priceOf(after, outcome)),
    priceImpact: priceBefore > 0 ? (exFeeAvg - priceBefore) / priceBefore : 0,
    reservesAfter: after,
  };
}

export interface SellQuote {
  collateralOut: bigint;
  grossOut: bigint;
  /** Trading fee: grossOut * feeBps / 10_000 (floor); collateralOut = grossOut − fee. */
  fee: bigint;
  /** Average USDC received per share, after fee, as a 0..1 number. */
  avgPrice: number;
  priceBefore: number;
  priceAfter: number;
  /** (marginal price before − avg received ex-fee) / marginal price before. */
  priceImpact: number;
  reservesAfter: Reserves;
}

/** Mirror of MarketsPerennial.sell / MarketsV4.sell: the curve (ceil-sqrt) gives
 *  grossOut, the fee is taken from it, the seller receives grossOut − fee. */
export function quoteSell(r: Reserves, outcome: number, sharesIn: bigint, feeBps: bigint): SellQuote | null {
  if (sharesIn <= 0n || r.yesReserve === 0n || r.noReserve === 0n) return null;
  const yesPost = outcome === OUTCOME.Yes ? r.yesReserve + sharesIn : r.yesReserve;
  const noPost = outcome === OUTCOME.No ? r.noReserve + sharesIn : r.noReserve;
  const k = r.yesReserve * r.noReserve;
  const sum = yesPost + noPost;
  const prod = yesPost * noPost;
  const disc = sum * sum - 4n * (prod - k);
  // The contract ceils the root and floors the halving so a sell never pays
  // over the curve; a floored root here promised 1 unit more than it paid.
  const grossOut = (sum - isqrtCeil(disc)) / 2n;
  const fee = (grossOut * feeBps) / BPS;
  const collateralOut = grossOut - fee;
  if (collateralOut <= 0n) return null;
  const after = { yesReserve: yesPost - grossOut, noReserve: noPost - grossOut };
  if (after.yesReserve === 0n || after.noReserve === 0n) return null; // ReserveDepleted
  const priceBefore = toNum(priceOf(r, outcome));
  const exFeeAvg = Number(grossOut) / Number(sharesIn);
  return {
    collateralOut,
    grossOut,
    fee,
    avgPrice: Number(collateralOut) / Number(sharesIn),
    priceBefore,
    priceAfter: toNum(priceOf(after, outcome)),
    priceImpact: priceBefore > 0 ? (priceBefore - exFeeAvg) / priceBefore : 0,
    reservesAfter: after,
  };
}

/** Minimum acceptable output for a slippage tolerance in bps (floor). */
export function minOutWithSlippage(expected: bigint, slippageBps: bigint): bigint {
  if (slippageBps < 0n || slippageBps >= BPS) throw new Error("slippage out of range");
  return (expected * (BPS - slippageBps)) / BPS;
}

/** LEGACY contract only: a voided market pays half a unit per share of either side.
 *  (v3 refunds net cost — see market-fees.ts.) */
export function voidPayout(yesShares: bigint, noShares: bigint): bigint {
  return (yesShares + noShares) / 2n;
}

/** What `redeem` would pay: winners 1:1 (legacy and v3), a legacy void $0.50 per
 *  share. v3 voids refund net cost: see market-fees.ts's mirrorRedeem. */
export function redeemPayout(
  m: { phase: number; yesWon: boolean },
  yesShares: bigint,
  noShares: bigint,
): bigint {
  if (m.phase === PHASE.Voided) return voidPayout(yesShares, noShares);
  if (m.phase === PHASE.Resolved) return m.yesWon ? yesShares : noShares;
  return 0n;
}

// ───────────────────────────── status ─────────────────────────────

export type MarketStatusKey =
  | "loading"
  | "trading"
  | "waiting"
  | "resolvable"
  | "voidable"
  | "resolved-yes"
  | "resolved-no"
  | "voided"
  | "closed-legacy";

export interface MarketStatus {
  key: MarketStatusKey;
  label: string;
  detail: string;
  canTrade: boolean;
  canResolve: boolean;
  canVoid: boolean;
  canRedeem: boolean;
  canClaimLP: boolean;
}

export interface StatusInput {
  /** undefined while loading — never treated as settled. */
  phase: number | undefined;
  yesWon?: boolean;
  expiry: bigint | undefined;
  /** Latest block timestamp (chain time, not the client clock). */
  chainNow: bigint | undefined;
  /** settlementState(id).state, or undefined when unread / unsupported. */
  settlement: number | undefined;
  /** False for the legacy contract (settlementState reverts). */
  supportsSettlement: boolean;
  /** Probed fee model; v3 ("trade") switches the void copy. */
  feeModel?: FeeModel;
}

const base = {
  canTrade: false,
  canResolve: false,
  canVoid: false,
  canRedeem: false,
  canClaimLP: false,
};

export function marketStatus(s: StatusInput): MarketStatus {
  const v3 = s.feeModel?.kind === "trade" ? s.feeModel : undefined;
  if (s.phase === undefined || s.expiry === undefined || s.chainNow === undefined) {
    return { ...base, key: "loading", label: "Loading", detail: "Reading market state…" };
  }
  if (s.phase === PHASE.Resolved) {
    const yes = Boolean(s.yesWon);
    return {
      ...base,
      key: yes ? "resolved-yes" : "resolved-no",
      label: yes ? "Resolved · YES won" : "Resolved · NO won",
      detail: yes ? "YES shares redeem for $1.00 each." : "NO shares redeem for $1.00 each.",
      canRedeem: true,
      canClaimLP: true,
    };
  }
  if (s.phase === PHASE.Voided) {
    return {
      ...base,
      key: "voided",
      label: "Voided",
      detail: v3
        ? `Voided — every trader gets their net cost back (what they put in after fees, minus what they took out); the agent's held ${bpsPct(v3.agentShareBps)} goes to its successful challenger (otherwise to the ${PAYEE[v3.payee].voidSink}).`
        : "No valid attestation settled it. Every YES and NO share redeems for $0.50.",
      canRedeem: true,
      canClaimLP: true,
    };
  }
  if (s.phase !== PHASE.Trading) {
    return { ...base, key: "loading", label: "Unknown", detail: `Unrecognised phase ${s.phase}.` };
  }
  if (s.chainNow < s.expiry) {
    return { ...base, key: "trading", label: "Trading", detail: "Open for trading until expiry.", canTrade: true };
  }
  if (!s.supportsSettlement) {
    return {
      ...base,
      key: "closed-legacy",
      label: "Closed",
      detail:
        "Trading has closed. This market runs on the legacy contract, which settles through the operator; settle and void are not available from this page.",
    };
  }
  switch (s.settlement) {
    case SETTLEMENT.Resolvable:
      return {
        ...base,
        key: "resolvable",
        label: "Resolvable",
        detail: "A finalized attestation decides it. Anyone can resolve.",
        canResolve: true,
      };
    case SETTLEMENT.Voidable:
      return {
        ...base,
        key: "voidable",
        label: "Voidable",
        detail: v3
          ? "No valid attestation arrived in the settlement window. Anyone can void it; every trader then gets their net cost back."
          : "No valid attestation arrived in the settlement window. Anyone can void it; shares then pay $0.50.",
        canVoid: true,
      };
    case SETTLEMENT.Waiting:
    case SETTLEMENT.Open:
      return {
        ...base,
        key: "waiting",
        label: "Waiting",
        detail: "Trading has closed; waiting for the settling attestation (or for it to finalize).",
      };
    default:
      return { ...base, key: "loading", label: "Loading", detail: "Reading settlement state…" };
  }
}

// ───────────────────────────── copy ─────────────────────────────

export function comparatorSymbol(c: number): string {
  return COMPARATOR_SYMBOL[c] ?? "?";
}

export function utcStamp(ts: bigint | number): string {
  const d = new Date(Number(ts) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export const shortHex = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/**
 * The market's question, derived from what the contract will actually check —
 * never a hard-coded string that could drift from the parameters.
 */
export function questionText(q: {
  subject: string;
  /** "verified artifacts" for a builder milestone feed, else undefined. */
  metric?: string;
  feedId: string;
  threshold: bigint;
  comparator: number;
  expiry: bigint;
  /** Legacy contract: settles on the latest attestation at or before expiry. */
  legacy?: boolean;
}): string {
  const metric = q.metric ?? `feed ${shortHex(q.feedId)} value`;
  const when = q.legacy ? `by ${utcStamp(q.expiry)}` : `at the first attestation after ${utcStamp(q.expiry)}`;
  return `${q.subject}: ${metric} ${comparatorSymbol(q.comparator)} ${q.threshold.toString()} ${when}?`;
}

/** Threshold for a new milestone market: one more verified artifact than the
 *  latest attested count. No attestation yet counts as 0. */
export function nextMilestoneThreshold(latest: bigint | null | undefined): bigint {
  if (latest === null || latest === undefined || latest < 0n) return 1n;
  return latest + 1n;
}

export function fmtDurationShort(sec: number): string {
  if (sec % 86_400 === 0) return `${sec / 86_400}d`;
  if (sec % 3_600 === 0) return `${sec / 3_600}h`;
  if (sec >= 3_600) return `${(sec / 3_600).toFixed(1)}h`;
  return `${Math.round(sec / 60)}m`;
}

/** Plain-English rule for a market that settles under SettlementPolicy. */
export function settlementRuleText(windowSecs: number | undefined, feeModel?: FeeModel): string {
  const w = windowSecs ? fmtDurationShort(windowSecs) : "the settlement window";
  const head = `Trading closes at expiry. The market settles on the FIRST valid attestation stamped between expiry and expiry + ${w}. `;
  if (feeModel?.kind === "trade") {
    return (
      head +
      `If none arrives in that window, the market voids: every trader gets their net cost back (what they put in after fees, minus what they took out). ` +
      `The agent's held ${bpsPct(feeModel.agentShareBps)} goes to whoever successfully challenged its answer, otherwise to the ${PAYEE[feeModel.payee].voidSink}.`
    );
  }
  return head + `If none arrives in that window, the market voids and every YES and NO share pays $0.50.`;
}

// ───────────────────────────── inputs ─────────────────────────────

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parse a USDC amount typed by a user into 6-decimal base units. */
export function parseUsdcInput(raw: string, opts: { min?: bigint; max?: bigint; label?: string } = {}): Parsed<bigint> {
  const label = opts.label ?? "amount";
  const s = raw.trim();
  if (!s) return { ok: false, error: `Enter an ${label}.` };
  if (s.startsWith("-")) return { ok: false, error: `The ${label} can't be negative.` };
  if (!/^\d*(\.\d*)?$/.test(s) || s === ".") return { ok: false, error: `"${raw}" is not a number.` };
  const [whole, frac = ""] = s.split(".");
  if (frac.length > USDC_DECIMALS) return { ok: false, error: `USDC has at most ${USDC_DECIMALS} decimal places.` };
  let value: bigint;
  try {
    value = BigInt(whole || "0") * ONE_USDC + BigInt((frac + "000000").slice(0, USDC_DECIMALS));
  } catch {
    return { ok: false, error: `"${raw}" is not a number.` };
  }
  if (value === 0n) return { ok: false, error: `Enter an ${label} above zero.` };
  if (opts.min !== undefined && value < opts.min) return { ok: false, error: `Minimum ${label} is ${formatUsdc(opts.min)} USDC.` };
  if (opts.max !== undefined && value > opts.max) return { ok: false, error: `Maximum ${label} is ${formatUsdc(opts.max)} USDC.` };
  return { ok: true, value };
}

/** Parse a whole number of days. */
export function parseDays(raw: string, min = 1, max = 365): Parsed<number> {
  const s = raw.trim();
  if (!s) return { ok: false, error: "Enter a number of days." };
  if (!/^\d+$/.test(s)) {
    if (/^-/.test(s)) return { ok: false, error: "Days can't be negative." };
    if (/^\d*\.\d+$/.test(s)) return { ok: false, error: "Use whole days." };
    return { ok: false, error: `"${raw}" is not a number of days.` };
  }
  const n = Number(s);
  if (n < min) return { ok: false, error: `At least ${min} day${min === 1 ? "" : "s"}.` };
  if (n > max) return { ok: false, error: `At most ${max} days.` };
  return { ok: true, value: n };
}

/** Parse a slippage tolerance in percent into bps (0.01% .. 50%). */
export function parseSlippagePct(raw: string): Parsed<bigint> {
  const s = raw.trim();
  if (!/^\d*(\.\d{0,2})?$/.test(s) || s === "" || s === ".") return { ok: false, error: "Slippage must be a percentage like 1 or 0.5." };
  const [w, f = ""] = s.split(".");
  const bps = BigInt(w || "0") * 100n + BigInt((f + "00").slice(0, 2));
  if (bps < 1n) return { ok: false, error: "Slippage must be above 0." };
  if (bps > 5_000n) return { ok: false, error: "Slippage above 50% is refused." };
  return { ok: true, value: bps };
}

/** Native USDC pays gas on Arc, so never let a deposit drain the wallet. */
export const GAS_RESERVE_USDC = 100_000n; // 0.10 USDC (6-dec)

export function maxDeposit(walletBalance: bigint, reserve: bigint = GAS_RESERVE_USDC): bigint {
  return walletBalance > reserve ? walletBalance - reserve : 0n;
}

/** Format 6-decimal USDC, ROUNDED DOWN (a balance is never shown higher than it is). */
export function formatUsdc(v: bigint, dp = 2): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / ONE_USDC;
  const frac = (a % ONE_USDC).toString().padStart(USDC_DECIMALS, "0").slice(0, dp).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? `.${frac}` : ""}`;
}

/** Contiguous inclusive block ranges of at most `size` blocks (Arc caps getLogs). */
export function blockChunks(from: bigint, to: bigint, size = 5_000n): Array<[bigint, bigint]> {
  if (size <= 0n) throw new Error("chunk size must be positive");
  const out: Array<[bigint, bigint]> = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    out.push([start, end > to ? to : end]);
  }
  return out;
}
