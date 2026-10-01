import { SESSION_COOKIE, SESSION_TTL_S } from "../../src/lib/builders-admin";
import type { Env } from "./env";

const BASE_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

/** A JSON response; private and uncached unless the caller says otherwise. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, "cache-control": "no-store", ...headers },
  });
}

export const errorJson = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

export const noContent = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

/** The configured site origin (no trailing slash); "" when unset. */
export function siteOrigin(env: Env): string {
  return (env.SITE_ORIGIN ?? "").trim().replace(/\/+$/, "");
}

export function isMutating(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

/**
 * CSRF for a mutating request: a JSON body (a cross-site form cannot send one
 * without a preflight) and an Origin header equal to the site origin. Returns
 * the reason it fails, or null.
 */
export function csrfFailure(req: Request, origin: string): string | null {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return "Content-Type must be application/json";
  if (!origin) return "SITE_ORIGIN is not configured";
  if (req.headers.get("origin") !== origin) return "cross-origin request refused";
  return null;
}

/** The request body as JSON, or undefined. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return JSON.parse(await req.text());
  } catch {
    return undefined;
  }
}

export function getCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export const sessionCookie = (token: string) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_S}`;
export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/** `bytes` random bytes as lowercase hex. */
export function randomHex(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The Workers edge cache (caches.default), when running on Cloudflare. */
export function edgeCache(): Cache | null {
  const c = (globalThis as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

export const PUBLIC_GET_CACHE_S = 60;
export interface EdgeCacheDeps {
  cache?: Cache | null;
  waitUntil?: (p: Promise<unknown>) => void;
}

/**
 * A public GET through the edge cache, keyed by the request's path alone (the query
 * string is ignored). Only a 200 or a 404 is kept, for PUBLIC_GET_CACHE_S; anything
 * else (400, 5xx) goes straight back. Never for /api/admin/*.
 */
export async function edgeCachedGet(req: Request, deps: EdgeCacheDeps, produce: () => Promise<Response>): Promise<Response> {
  const cache = deps.cache === undefined ? edgeCache() : deps.cache;
  const u = new URL(req.url);
  const key = new Request(`${u.origin}${u.pathname}`, { method: "GET" });
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  const res = await produce();
  if (!cache || (res.status !== 200 && res.status !== 404)) return res;
  const headers = new Headers(res.headers);
  headers.set("cache-control", `public, max-age=${PUBLIC_GET_CACHE_S}`);
  const out = new Response(res.body, { status: res.status, headers });
  const put = cache.put(key, out.clone());
  if (deps.waitUntil) deps.waitUntil(put);
  else await put;
  return out;
}
