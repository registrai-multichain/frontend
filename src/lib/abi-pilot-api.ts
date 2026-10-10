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
  origin: string;
  nonce: string;
  /** ISO 8601 UTC, e.g. 2026-10-10T12:00:00.000Z */
  issued: string;
}

const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** The exact bytes a wallet signs (EIP-191 personal_sign). */
export function pilotLoginMessage(p: PilotLogin): string {
  return [PILOT_LOGIN_TITLE, PILOT_LOGIN_NOTE, `origin: ${p.origin}`, `nonce: ${p.nonce}`, `issued: ${p.issued}`].join("\n");
}

/** A sign-in message back into its fields; null unless it is exactly the canonical form. */
export function parsePilotLoginMessage(message: string): PilotLogin | null {
  const lines = message.split("\n");
  if (lines.length !== 5 || lines[0] !== PILOT_LOGIN_TITLE || lines[1] !== PILOT_LOGIN_NOTE) return null;
  const origin = /^origin: (.+)$/.exec(lines[2])?.[1];
  const nonce = /^nonce: (.+)$/.exec(lines[3])?.[1];
  const issued = /^issued: (.+)$/.exec(lines[4])?.[1];
  if (!origin || !ORIGIN_RE.test(origin)) return null;
  if (!nonce || !NONCE_RE.test(nonce)) return null;
  if (!issued || !ISO_RE.test(issued) || !Number.isFinite(Date.parse(issued))) return null;
  const parsed = { origin, nonce, issued };
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
  order: "/api/pilot/order",
  close: "/api/pilot/close",
  positions: "/api/pilot/positions",
  history: "/api/pilot/history",
  leaderboard: "/api/pilot/leaderboard",
} as const;

export const PILOT_LIMITS = {
  ordersPerMin: 30,
  closesPerMin: 60,
  loginsPerMin: 10,
  leaderboard: 50,
  history: 100,
  leaderboardCacheS: 30,
} as const;

export interface PilotMark {
  mark: number;
  ts: number;
  /** Seconds since `ts` at the server's clock. */
  age: number;
  ch24: number;
  ch1: number;
  maxLev: number;
  paused: boolean;
  /** At most RULES.markMaxAgeS old: orders and closes are accepted. */
  fresh: boolean;
}

export interface OpenPositionView {
  id: number;
  side: Side;
  margin: number;
  lev: number;
  notional: number;
  entry: number;
  liq: number;
  openedAt: number;
  fee: number;
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
  liq: number;
  openedAt: number;
  closedAt: number;
  exit: number;
  pnl: number;
  /** Open fee + close fee. */
  fee: number;
  /** Points returned to the balance at close (0 when liquidated). */
  returned: number;
  /** returned − margin − open fee. */
  net: number;
  reason: "close" | "liquidation";
}

export interface PilotAccountView {
  /** PILOT_OPEN: new orders accepted. */
  open: boolean;
  address: string | null;
  /** The cached REGI check (null: not signed in). */
  regi: boolean | null;
  account: { balance: number; equity: number | null; season: number } | null;
  positions: OpenPositionView[];
  mark: PilotMark | null;
}

export interface LeaderboardRow {
  rank: number;
  /** 0x1234…abcd */
  address: string;
  equity: number;
}

/** 0x1234…abcd */
export function shortWallet(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
