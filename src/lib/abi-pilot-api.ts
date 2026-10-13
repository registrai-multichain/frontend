/**
 * ABI points pilot: what the terminal page (browser) and the builders-site
 * /api/pilot/* Functions (server) agree on: the sign-in message, the REGI gate
 * constants, the response shapes, the address shortening.
 *
 * Pure. RELATIVE IMPORTS ONLY: wrangler bundles this file into the Pages Functions.
 */
import type { Side } from "./abi-pilot";
import { ABI_INDEX_IDS, ABI_INDICES, type AbiIndexId } from "./builders-index";

// ───────────────────────────── markets ─────────────────────────────

/**
 * The pilot's markets (plan 2026-10-12 R1, spec §9.16): one per Arc index, ABI, AII and AEI. One points balance per
 * wallet across them; mark, bars, rates, house, insurance and split are per market.
 */
export type PilotMarket = AbiIndexId;
export const PILOT_MARKETS: readonly PilotMarket[] = ABI_INDEX_IDS;
export const DEFAULT_MARKET: PilotMarket = "abi";
/** A request's market: absent (undefined / null / "") is ABI; anything else must be one of PILOT_MARKETS (else null). */
export function marketOf(v: unknown): PilotMarket | null {
  if (v === undefined || v === null || v === "") return DEFAULT_MARKET;
  return typeof v === "string" && (PILOT_MARKETS as readonly string[]).includes(v) ? (v as PilotMarket) : null;
}
/** "ABI", "AII", "AEI" */
export const marketCode = (m: PilotMarket) => ABI_INDICES[m].code;

// ───────────────────────────── sign-in ─────────────────────────────

export const PILOT_LOGIN_TITLE = "Registrai ABI points pilot sign-in";
export const PILOT_LOGIN_NOTE = "I am 18 or older and accept the Terms of use (/terms). Signing in is not a transaction and costs nothing.";
export const PILOT_SESSION_COOKIE = "__Host-rb_pilot";
export const PILOT_SESSION_TTL_S = 12 * 60 * 60;

export interface PilotLogin {
  /** The signing wallet, lowercase: the server checks the signature recovers to it. */
  address: string;
  origin: string;
  nonce: string;
  /** ISO 8601 UTC, e.g. 2026-10-10T12:00:00.000Z */
  issued: string;
}

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** The exact bytes a wallet signs (EIP-191 personal_sign). */
export function pilotLoginMessage(p: PilotLogin): string {
  return [PILOT_LOGIN_TITLE, PILOT_LOGIN_NOTE, `address: ${p.address.toLowerCase()}`, `origin: ${p.origin}`, `nonce: ${p.nonce}`, `issued: ${p.issued}`].join("\n");
}

/** A sign-in message back into its fields; null unless it is exactly the canonical form. */
export function parsePilotLoginMessage(message: string): PilotLogin | null {
  const lines = message.split("\n");
  if (lines.length !== 6 || lines[0] !== PILOT_LOGIN_TITLE || lines[1] !== PILOT_LOGIN_NOTE) return null;
  const address = /^address: (.+)$/.exec(lines[2])?.[1];
  const origin = /^origin: (.+)$/.exec(lines[3])?.[1];
  const nonce = /^nonce: (.+)$/.exec(lines[4])?.[1];
  const issued = /^issued: (.+)$/.exec(lines[5])?.[1];
  if (!address || !ADDRESS_RE.test(address)) return null;
  if (!origin || !ORIGIN_RE.test(origin)) return null;
  if (!nonce || !NONCE_RE.test(nonce)) return null;
  if (!issued || !ISO_RE.test(issued) || !Number.isFinite(Date.parse(issued))) return null;
  const parsed = { address, origin, nonce, issued };
  return pilotLoginMessage(parsed) === message ? parsed : null;
}

// ───────────────────────────── REGI gate ─────────────────────────────

export const ARC_CHAIN_ID = 5042;
export const ARC_RPC_URL = "https://rpc.mainnet.arc.io";
export const REGI_ADDRESS = "0x93D5b8c53ee763C2c4522bF0d958ce51Af4360ae";
/** REGI has 18 decimals. */
export const REGI_UNIT = 10n ** 18n;
/** REGI's contract has code from this Arc block on (audit PE-7): a snapshot block (when one is set) before it is a misconfiguration. */
export const REGI_DEPLOY_BLOCK = 22_419_071;
/** The pilot's leverage cap on top of the engine's (owner decision 2026-10-11, audit F2; PILOT_MAX_LEV overrides it). */
export const PILOT_MAX_LEV_DEFAULT = 10;
export const BALANCE_OF_SELECTOR = "0x70a08231";
/** A cached REGI check is reused for at most this long (the account view, the leaderboard; never an order). */
export const REGI_CACHE_S = 10 * 60;

// ───────────────────────────── REGI in dollars (plan 2026-10-13 R1–R3) ─────────────────────────────

/**
 * Owner decisions 2026-10-13: holding $10 of REGI admits a wallet (at sign-in and at each order; PILOT_ADMIT_USD), and
 * $50 of REGI locked in the wallet's own vault unlocks leverage (PILOT_LOCK_USD). Dollars are converted at the median
 * of the last 24 h of the site's own REGI/USDC pool samples.
 */
export const PILOT_ADMIT_USD_DEFAULT = 10;
export const PILOT_LOCK_USD_DEFAULT = 50;
/** The REGI/USDC Uniswap v4 pool on Arc: currency0 USDC (0x3600…, 6 decimals), currency1 REGI (18 decimals). */
export const REGI_POOL_ID = "0x0530f18eb32d732cc8b067bbd0b2ba7e5d807d4f5cf4f7d74429f2a78d3120c8";
export const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
/** keccak256(abi.encode(REGI_POOL_ID, 6)): the pool's slot0 in the PoolManager (v4-core StateLibrary, POOLS_SLOT = 6). */
export const REGI_POOL_SLOT0 = "0xbfb2c46a4308e57a10d2c1bd1de3d26f82e89e6a8d840e77e53def66f1f0f999";
/** Function selectors (test: src/lib/abi-pilot-lock.test.ts checks each against its signature). */
export const SELECTORS = {
  /** PoolManager.extsload(bytes32) */
  extsload: "0x1e2eaeaf",
  /** RegiLockFactory.lockedOf(address) */
  lockedOf: "0xa5f1e282",
} as const;
/** RegiLockFactory's Withdrawn(address indexed owner, address indexed vault, uint256 amount). */
export const WITHDRAWN_TOPIC = "0xd1c19fbcd4551a5edfb66d43d2e337c04837afda3482b42bdf569a8fccdae5fb";
/** The site samples the pool at most once per this many seconds (one sample per slot of this length). */
export const PRICE_SAMPLE_S = 10 * 60;
/** The price is the median of the samples of this window… */
export const PRICE_WINDOW_S = 24 * 3600;
/** …and unknown (fail closed) with fewer samples than this in it. */
export const PRICE_MIN_SAMPLES = 6;
/** The withdrawal watch runs at most once per this many seconds, and reads logs in chunks of at most LOG_CHUNK blocks. */
export const LOCK_WATCH_S = 60;
export const LOG_CHUNK = 5000;
/** The lock form's default amount: the requirement plus this share. */
export const LOCK_HEADROOM = 0.05;
/**
 * The lock factory's address for the static pages (the Pilot rules); the server's is PILOT_LOCK_FACTORY. Empty until
 * the owner deploys the factory: set both to the same address.
 */
export const LOCK_FACTORY_ADDRESS = "";

/**
 * USD per REGI from the pool's sqrtPriceX96: (sqrtP / 2^96)^2 is raw REGI per raw USDC, so REGI per USDC is that
 * × 10^6 / 10^18, and USD per REGI its inverse. null when the pool has no price (0).
 */
export function usdPerRegiOf(sqrtPriceX96: bigint): number | null {
  if (sqrtPriceX96 <= 0n) return null;
  const rawRegiPerRawUsdc = (Number(sqrtPriceX96) / 2 ** 96) ** 2;
  const usd = 1e12 / rawRegiPerRawUsdc;
  return Number.isFinite(usd) && usd > 0 ? usd : null;
}

/** The low 160 bits of the pool's slot0 word (hex): sqrtPriceX96. */
export const sqrtPriceOfSlot0 = (word: string) => BigInt(word) & ((1n << 160n) - 1n);

/** Median of finite positive numbers (the mean of the two middle ones for an even count); null when empty. */
export function median(xs: readonly number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const h = v.length >> 1;
  return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}

/**
 * The REGI (raw, 18 decimals) that `usd` dollars buy at `usdPerRegi`, rounded UP to a millionth of a REGI. A quotient
 * within one part in 10^14 of a whole millionth is taken as that millionth, so float noise (10 / 1e-5 =
 * 1000000.0000000001) never adds one; any real fraction (below 10^8 REGI) still rounds up.
 */
export function regiFor(usd: number, usdPerRegi: number): bigint {
  const x = (usd / usdPerRegi) * 1e6;
  const r = Math.round(x);
  const micro = Math.abs(x - r) <= x * 1e-14 ? r : Math.ceil(x);
  return BigInt(micro) * 10n ** 12n;
}

/** Whole REGI, floored, for display. */
export const wholeRegiOf = (raw: bigint | string) => Number(BigInt(raw) / REGI_UNIT);
/** "1,234,567 REGI" (rounded up when `up`, so a requirement is never shown short). */
export function fmtRegi(raw: bigint | string, up = false): string {
  const r = BigInt(raw);
  const whole = r / REGI_UNIT + (up && r % REGI_UNIT > 0n ? 1n : 0n);
  return `${Number(whole).toLocaleString("en-US")} REGI`;
}
/** "$10" / "$12.50" */
export const fmtUsd = (usd: number) => `$${usd.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(usd) ? 0 : 2, maximumFractionDigits: 2 })}`;
/** "Hold at least $10 of REGI to join the points pilot." (PILOT_ADMIT_USD) */
export const holdUsdText = (usd: number) => `Hold at least ${fmtUsd(usd)} of REGI to join the points pilot.`;
/** "Lock at least $50 of REGI to trade with leverage." (PILOT_LOCK_USD) */
export const lockUsdText = (usd: number) => `Lock at least ${fmtUsd(usd)} of REGI to trade with leverage.`;
/** Both the admission and the leverage check answer this while the price is unknown (fewer than PRICE_MIN_SAMPLES). */
export const REGI_PRICE_UPDATING = "REGI price updating";

// ───────────────────────────── API ─────────────────────────────

/** `path` for one market (ABI is the default and needs no parameter, so today's URLs stay as they are). */
export const withMarket = (path: string, m: PilotMarket) => (m === DEFAULT_MARKET ? path : `${path}?market=${m}`);

export const PILOT_PATHS = {
  auth: "/api/pilot/auth",
  account: "/api/pilot/account",
  /** POST an open order; GET ?id= its status. */
  order: "/api/pilot/order",
  /** POST a close order (status: GET /api/pilot/order?id=). */
  close: "/api/pilot/close",
  positions: "/api/pilot/positions",
  history: "/api/pilot/history",
  leaderboard: "/api/pilot/leaderboard",
  /** Public: the last 24 hourly rates (edge-cached 60 s). */
  funding: "/api/pilot/funding",
  /** Public: skew, funding, the house, the fee pool, insurance and the weekly split (edge-cached 30 s). */
  economy: "/api/pilot/economy",
} as const;

export const PILOT_LIMITS = {
  ordersPerMin: 30,
  closesPerMin: 60,
  /** Pending orders (opens and closes) one wallet may have waiting for the next mark (audit SS-5). */
  pendingPerWallet: 3,
  loginsPerMin: 10,
  leaderboard: 50,
  history: 100,
  leaderboardCacheS: 60,
  /** One leaderboard build re-checks at most this many stale REGI balances on the RPC (in parallel waves). */
  leaderboardRegiChecks: 60,
  fundingCacheS: 60,
  economyCacheS: 30,
  /** REGI RPC back-off after a failure. */
  regiRetryS: 30,
  /** Orders pause this long after the hour's base sample lands (base_step_ts). */
  basePauseS: 60,
  /** New orders (not closes) pause this long after a recorded index milestone (milestone_ts). */
  milestonePauseS: 60,
  /** Funding rates shown on the page. */
  fundingShown: 24,
} as const;

export interface PilotMark {
  mark: number;
  ts: number;
  /** Seconds since `ts` at the server's clock. */
  age: number;
  ch24: number;
  ch1: number;
  sigma1h: number | null;
  sigma24h: number | null;
  /** The highest leverage an order may use now: the engine's cap (volatility, jump) and the pilot's cap, the lower. */
  maxLev: number;
  /** The pilot's own cap (PILOT_MAX_LEV): the ticket offers no level above it. */
  levCap: number;
  /** The engine's pause (the last hour moved more than max(5σ_1h, 0.5%)). */
  paused: boolean;
  /** Paused around the hour's base sample (base_pending, or under 60 s after base_step_ts). */
  basePaused: boolean;
  /** New orders paused: under 60 s after a recorded index milestone (closes go on). */
  milestonePaused: boolean;
  /** At most RULES.markMaxAgeS old: the producer is live, so an order will fill at the next mark. */
  fresh: boolean;
}

export interface OpenPositionView {
  id: number;
  market: PilotMarket;
  side: Side;
  margin: number;
  lev: number;
  notional: number;
  entry: number;
  /** Liquidation price now (funding and borrow paid so far move it). */
  liq: number;
  openedAt: number;
  fee: number;
  /** Funding so far (positive = received, negative = paid). */
  funding: number;
  /** Borrow fee paid so far (points). */
  borrow: number;
  /** The position's market's latest mark (null without one). */
  mark: number | null;
  /** At its market's latest mark (null without one). */
  pnl: number | null;
  /** The REGI lock requirement in force when it opened (raw, decimal string; "0" at 1×). Withdrawing below it closes the position. */
  lockReq: string;
}

export interface ClosedPositionView {
  id: number;
  market: PilotMarket;
  side: Side;
  margin: number;
  lev: number;
  notional: number;
  entry: number;
  openedAt: number;
  closedAt: number;
  exit: number;
  pnl: number;
  /** Positive = received. */
  funding: number;
  borrow: number;
  /** Open fee + close fee. */
  fee: number;
  /** Points returned to the balance at close (0 when liquidated). */
  returned: number;
  /** returned − margin − open fee. */
  net: number;
  /** "lock withdrawn": closed by the site (normal close settlement) because the wallet withdrew REGI below the position's lock requirement. */
  reason: "close" | "liquidation" | "lock withdrawn";
}

export interface OrderView {
  id: number;
  market: PilotMarket;
  kind: "open" | "close";
  status: "pending" | "filled" | "refused";
  side: Side | null;
  margin: number | null;
  lev: number | null;
  positionId: number | null;
  arrivedMs: number;
  fillPx: number | null;
  error: string | null;
}

export interface RegiView {
  /**
   * The last known state (the account view; an order always re-reads the balance): holds the admission amount (admitRegi)
   * now and, when a snapshot block is set, held it there. null = couldn't check.
   */
  ok: boolean | null;
  /** Held the minimum at PILOT_REGI_SNAPSHOT_BLOCK; null when no snapshot block is set or it couldn't be checked. */
  snapshot: boolean | null;
  now: boolean | null;
}

/** This hour's rates, per unit of notional per hour: + = the side pays, − = it receives. null: not fixed yet. */
export interface FundingNow {
  hour: number;
  long: number | null;
  short: number | null;
  /** (L − S) / (L + S) of the traders' book at the fix. */
  skew: number | null;
  /** When the next hour's rates take over (unix s). */
  next: number;
}

/** One hour's rates (in force during [t, t + 1h)), as fixed at the hour's start. */
export interface RateView {
  t: number;
  long: number;
  short: number;
  skew: number;
  /** The ex-milestone drift (trend term). */
  trend: number;
  /** §9.15: the milestone premium longs pay (to the house); included in `long`. 0 before it existed. */
  premium: number;
  /** The skew term: > 0 longs heavy. */
  r: number;
  /** The protocol cut projected for the hour (points). */
  cut: number;
  /** Traders' open notional at the fix. */
  L: number;
  S: number;
  /** S − L: the house's side of the book (+ = long). */
  houseExposure: number;
}

/** GET /api/pilot/funding (public, edge-cached). */
export interface FundingView {
  market: PilotMarket;
  /** Newest first, the last 24. */
  recent: RateView[];
  /** The hour in force now, if fixed. */
  current: RateView | null;
  next: number;
}

export interface EconomyWindow {
  h24: number;
  week: number;
  all: number;
}

/** GET /api/pilot/economy (public, edge-cached 30 s). Everything in points. */
export interface EconomyView {
  /** The market (?market=, default ABI): every figure is that market's. */
  market: PilotMarket;
  ts: number;
  rates: { current: RateView | null; recent: RateView[] };
  borrowApr: number;
  house: {
    /** Signed notional this hour (+ = long), null before the hour's rates are fixed. */
    exposure: number | null;
    /** Realized (settled) result not yet split; negative = a loss carried forward. */
    realized: number;
    /** The house's mark-to-market and accruals on positions still open (stays in its book until they settle). */
    unrealized: number;
    /** P&L by line, last 24 h, this week (since Monday 00:00 UTC) and all time. */
    price: EconomyWindow;
    funding: EconomyWindow;
    /** To the exact counterparty result: the hourly true-up and each settlement's residual. */
    trueup: EconomyWindow;
    /** Equity left at liquidations, less gaps insurance could not cover. */
    liquidations: EconomyWindow;
    total: EconomyWindow;
  };
  /** Fee pool by source since the last split; house = max(0, the house's realized unsplit result). */
  pool: { fee: number; borrow: number; cut: number; house: number; total: number };
  insurance: number;
  /** Treasury share from all splits, and the buyback earmark inside it. */
  treasury: number;
  buyback: number;
  /** The running week (since the last split): its pool and how it would split now. */
  week: { start: number; pool: number; insurance: number; treasury: number; buyback: number };
  lastSplit: { week: number; ts: number; pool: number; insurance: number; treasury: number; buyback: number } | null;
}

export interface PilotAccountView {
  /** The market the view's mark and funding are for (?market=, default ABI); positions and orders cover every market. */
  market: PilotMarket;
  /** PILOT_OPEN = "1" and the pilot's settings are valid: new orders accepted. */
  open: boolean;
  /** PILOT_OPEN = "1" but a setting is invalid (the snapshot block, PILOT_ADMIT_USD, PILOT_LOCK_USD, PILOT_LOCK_FACTORY, PILOT_MAX_LEV): every order is refused. */
  misconfigured: boolean;
  /** PILOT_ADMIT_USD: the REGI (in dollars) a wallet must hold at sign-in and when it places each order. */
  admitUsd: number;
  /** PILOT_LOCK_USD: the REGI (in dollars) a wallet must have locked in its vault to use leverage above 1×. */
  lockUsd: number;
  /** USD per REGI: the median of the last 24 h of pool samples; null while unknown (fewer than PRICE_MIN_SAMPLES). */
  price: number | null;
  /** The admission and the lock requirement in raw REGI (18 decimals, decimal strings) at `price`; null while it is unknown. */
  admitRegi: string | null;
  lockRegi: string | null;
  /** PILOT_LOCK_FACTORY (lowercase), or null while the lock factory is not deployed: leverage above 1× is refused. */
  lockFactory: string | null;
  /** A PILOT_REGI_SNAPSHOT_BLOCK is set: the wallet must also have held the admission amount at that block. */
  regiSnapshot: boolean;
  address: string | null;
  regi: RegiView | null;
  /** One balance across markets; equity = balance + every open position at its own market's latest mark. */
  account: { balance: number; equity: number | null; season: number } | null;
  /** Open positions in every market. */
  positions: OpenPositionView[];
  pending: OrderView[];
  /** The view's market's mark and this hour's rates. */
  mark: PilotMark | null;
  funding: FundingNow;
}

export interface LeaderboardRow {
  rank: number;
  /** 0x1234…abcd */
  address: string;
  equity: number;
}

/** Account refresh while signed in and the page is visible (D1 budget: one cheap read per poll). */
export const ACCOUNT_POLL_MS = 15_000;
/** While one of the wallet's orders is pending (it fills or is refused within ~10 s). */
export const PENDING_POLL_MS = 2_000;
export const BOARD_POLL_MS = 60_000;

/** The next account refresh: none signed out; faster only while an order is pending. */
export function accountPollMs(view: Pick<PilotAccountView, "address" | "pending"> | null): number | null {
  if (!view?.address) return null;
  return view.pending.length ? PENDING_POLL_MS : ACCOUNT_POLL_MS;
}

/** 0x1234…abcd */
export function shortWallet(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
