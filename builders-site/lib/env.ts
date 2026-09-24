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

/** builders-site/wrangler.toml */
export interface Env {
  /** Invites, sign-in nonces, admin sessions. */
  INVITES: KV;
  /** Comma-separated admin addresses (lowercase). Empty = nobody can sign in. */
  ADMIN_ADDRESSES?: string;
  /** https://builder.registrai.cc — sign-in, CSRF and claim links are bound to it. */
  SITE_ORIGIN?: string;
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
