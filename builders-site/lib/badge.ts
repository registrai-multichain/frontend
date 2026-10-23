/**
 * GET /badge/<net>/<n>.jpg and /badge/<net>/<n>-lapsed.jpg on the builders site
 * (mainnet's badge imageBase is https://builder.registrai.cc/badge/arc/). The
 * art is pre-rendered ahead of issuance (scripts/render-badges.py); a serial
 * issued past the rendered ones gets the generic picture (no number:
 * badge-generic.jpg / badge-generic-lapsed.jpg) until the next deploy renders
 * it, instead of a broken image in wallets and explorers.
 *
 * Every other /badge/ path (card.jpg, the generic files themselves, unknown
 * networks) is the static file as it is.
 */
import type { Env } from "./env";

export const BADGE_NETWORKS = new Set(["arc", "arc-testnet", "local"]);
const SERIAL_FILE = /^([1-9]\d{0,8})(-lapsed)?\.jpg$/;

/** Pure: a serial badge request (`/badge/<net>/<n>[-lapsed].jpg`), else null. */
export function parseBadgePath(pathname: string): { net: string; serial: number; lapsed: boolean } | null {
  const m = /^\/badge\/([a-z-]+)\/([^/]+)$/.exec(pathname);
  if (!m || !BADGE_NETWORKS.has(m[1])) return null;
  const f = SERIAL_FILE.exec(m[2]);
  return f ? { net: m[1], serial: Number(f[1]), lapsed: Boolean(f[2]) } : null;
}

/** The generic picture a missing serial falls back to. */
export const genericBadgePath = (net: string, lapsed: boolean) => `/badge/${net}/badge-generic${lapsed ? "-lapsed" : ""}.jpg`;

export async function handleBadge(req: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) return new Response("not found", { status: 404 });
  const url = new URL(req.url);
  const asset = await env.ASSETS.fetch(req);
  const want = parseBadgePath(url.pathname);
  if (!want || asset.ok) return asset;
  const generic = await env.ASSETS.fetch(new Request(new URL(genericBadgePath(want.net, want.lapsed), url).toString(), { method: req.method }));
  if (!generic.ok) return asset;
  const headers = new Headers(generic.headers);
  // Short: the numbered picture replaces it at the next deploy.
  headers.set("cache-control", "public, max-age=300");
  headers.set("x-registrai-badge", "generic");
  return new Response(req.method === "HEAD" ? null : generic.body, { status: 200, headers });
}
