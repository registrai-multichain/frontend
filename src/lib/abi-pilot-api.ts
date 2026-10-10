/**
 * ABI points pilot: what the terminal page (browser) and the builders-site
 * /api/pilot/* Functions (server) agree on: the sign-in message, the REGI gate
 * constants, the response shapes, the address shortening.
 *
 * Pure. RELATIVE IMPORTS ONLY: wrangler bundles this file into the Pages Functions.
 */
import type { Side } from "./abi-pilot";

// ───────────────────────────── sign-in ─────────────────────────────

export const PILOT_LOGIN_TITLE = "Registrai ABI points pilot sign-in";
export const PILOT_LOGIN_NOTE = "Signing in is not a transaction and costs nothing.";
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
/** 1 REGI (18 decimals). */
export const REGI_MIN = 10n ** 18n;
export const BALANCE_OF_SELECTOR = "0x70a08231";
/** A cached REGI check is reused for at most this long. */
export const REGI_CACHE_S = 10 * 60;

// ───────────────────────────── API ─────────────────────────────

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
  /** Public: the last 24 hourly funding rates (edge-cached 60 s). */
  funding: "/api/pilot/funding",
} as const;

export const PILOT_LIMITS = {
  ordersPerMin: 30,
  closesPerMin: 60,
  loginsPerMin: 10,
  leaderboard: 50,
  history: 100,
  leaderboardCacheS: 60,
  fundingCacheS: 60,
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
  maxLev: number;
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
  side: Side;
  margin: number;
  lev: number;
  notional: number;
  entry: number;
  /** Liquidation price now (funding accrued so far moves it). */
  liq: number;
  openedAt: number;
  fee: number;
  /** Funding accrued so far (positive = credited). */
  funding: number;
  /** At the latest mark (null without one). */
  pnl: number | null;
}

export interface ClosedPositionView {
  id: number;
  side: Side;
  margin: number;
  lev: number;
  notional: number;
  entry: number;
  openedAt: number;
  closedAt: number;
  exit: number;
  pnl: number;
  funding: number;
  /** Open fee + close fee. */
  fee: number;
  /** Points returned to the balance at close (0 when liquidated). */
  returned: number;
  /** returned − margin − open fee. */
  net: number;
  reason: "close" | "liquidation";
}

export interface OrderView {
  id: number;
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
  /** Eligible: held ≥ 1 REGI at the snapshot block and now. null = couldn't check. */
  ok: boolean | null;
  snapshot: boolean | null;
  now: boolean | null;
}

export interface FundingNow {
  /** The rate in force now (null: none posted for this hour). */
  current: number | null;
  /** When the next hour's rate takes over (unix s). */
  next: number;
}

/** GET /api/pilot/funding (public, edge-cached). */
export interface FundingView extends FundingNow {
  /** Newest first: the rate in force during [t, t + 1h). */
  recent: { t: number; rate: number }[];
}

export interface PilotAccountView {
  /** PILOT_OPEN = "1" and a REGI snapshot block is set: new orders accepted. */
  open: boolean;
  address: string | null;
  regi: RegiView | null;
  account: { balance: number; equity: number | null; season: number } | null;
  positions: OpenPositionView[];
  pending: OrderView[];
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
