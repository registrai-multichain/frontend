/**
 * Minimal Cloudflare types for the builders-site Pages Functions
 * (@cloudflare/workers-types is not installed; these are the few members used).
 */

export interface KVListKey<M = unknown> {
  name: string;
  expiration?: number;
  metadata?: M;
}

/** The subset of a Workers KV namespace used here. */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list<M = unknown>(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: KVListKey<M>[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

/** The subset of Cloudflare D1 used here (the points pilot). Ordered `?` parameters only. */
export interface D1Meta {
  changes: number;
  last_row_id: number;
  /** D1's billing counters (rows scanned / written, indexes included). */
  rows_read?: number;
  rows_written?: number;
  [k: string]: unknown;
}
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** One transaction: every statement or none; results in order. */
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

/** Pages' static assets binding (the packaged dist-builders files). */
export interface AssetsFetcher {
  fetch(input: Request | string): Promise<Response>;
}

/** builders-site/wrangler.toml */
export interface Env {
  /** Pages' own binding: the static files (present on every Pages deployment). */
  ASSETS?: AssetsFetcher;
  /** Invites, sign-in nonces, admin sessions. */
  INVITES: KV;
  /** Comma-separated admin addresses (lowercase). Empty = nobody can sign in. */
  ADMIN_ADDRESSES?: string;
  /** Comma-separated onboarder addresses: they sign in to read and onboard only (every admin API change is refused). */
  ONBOARDER_ADDRESSES?: string;
  /** https://builder.registrai.cc — sign-in, CSRF and claim links are bound to it. */
  SITE_ORIGIN?: string;
  /** Pages SECRET (never in wrangler.toml): the HMAC key of the stateless sign-in nonces. Unset = sign-in fails closed (500). */
  NONCE_SECRET?: string;
  /** Pages SECRET: the Telegram bot's bearer for /api/bot/invites. Unset = that route fails closed (503). */
  BOT_SECRET?: string;
  /** Pages SECRET: the radar keeper's bearer for POST /api/bot/track. Under 32 characters = that route fails closed (503). */
  RADAR_PUBLISH_SECRET?: string;
  /** Pages SECRET: the Arc Builders Index producer's bearer for POST /api/index. Under 32 characters = that route fails closed (503). */
  ABI_PUSH_TOKEN?: string;
  /** D1 "registrai-pilot" (builders-site/migrations): the ABI points pilot's accounts, positions, minute bars and latest mark. Unset = /api/pilot/* and /api/index/mark answer 503. */
  PILOT_DB?: D1Database;
  /** Data API v1 history (registrai-data; lib/data-api*.ts). */
  DATA_DB?: D1Database;
  /** Kill switch: "1" accepts new pilot orders (if the settings below are valid); anything else (the default) refuses them with 403 {error:"pilot closed"}. Closes and reads always work. */
  PILOT_OPEN?: string;
  /**
   * Optional REGI snapshot block (spec §8.4). Empty or unset (the default, owner decision 2026-10-12): no snapshot
   * check. Set: a wallet may open positions only if it also held the admission amount (PILOT_ADMIT_USD at today's median) at this Arc block; with PILOT_OPEN "1"
   * it must then be a block number from REGI's deploy (22,419,071) up to the current head, else the pilot is
   * misconfigured and refuses every order (audit PE-7).
   */
  PILOT_REGI_SNAPSHOT_BLOCK?: string;
  /**
   * Dollars of REGI a wallet must hold at sign-in and when it places each order (read fresh; plan 2026-10-13 R2), at
   * the 24 h median pool price; also at the snapshot block if one is set. Default "10". Not a positive number (up to 2
   * decimals) = misconfigured.
   */
  PILOT_ADMIT_USD?: string;
  /** Dollars of REGI a wallet must have locked in its RegiVault to place an order above 1× (R3). Default "50". Not a positive number = misconfigured. */
  PILOT_LOCK_USD?: string;
  /** The RegiLockFactory address (R3). Empty (the default, until the owner deploys it): leverage above 1× is refused. Set but not an address = misconfigured. */
  PILOT_LOCK_FACTORY?: string;
  /** The factory's deploy block: the withdrawal watch's first run starts there. */
  PILOT_LOCK_FROM_BLOCK?: string;
  /** The pilot's leverage cap, applied after the engine's. Default "10". Not an integer ≥ 1 = misconfigured. */
  PILOT_MAX_LEV?: string;
  /** Comma-separated lowercase addresses that may not open positions (milestone recorders, audit F4). Closes still work. */
  PILOT_BLOCKED_WALLETS?: string;
  /** Pages SECRET: the HMAC key of the pilot session cookie. Under 32 characters = pilot sign-in fails closed (503). */
  PILOT_SESSION_SECRET?: string;
}

export interface PagesContext<D extends Record<string, unknown> = Record<string, unknown>> {
  request: Request;
  env: Env;
  data: D;
  next(): Promise<Response>;
  waitUntil(promise: Promise<unknown>): void;
  params: Record<string, string | string[]>;
}

export type PagesFunction<D extends Record<string, unknown> = Record<string, unknown>> = (
  ctx: PagesContext<D>,
) => Response | Promise<Response>;
