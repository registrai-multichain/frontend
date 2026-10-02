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
  /** https://app.registrai.cc — the only origin /api/market-proposals accepts submissions from (CORS). */
  PROPOSALS_ALLOWED_ORIGIN?: string;
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
