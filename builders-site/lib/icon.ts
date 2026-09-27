/**
 * GET /api/icon?source=domain:<host> — a domain project's own site icon
 * (src/lib/site-icon.ts), so the gallery shows it instead of an initial.
 *
 *   200 the image (PNG, JPEG, GIF, WebP or ICO by its bytes), cached a day:
 *       the site's own icon, else its mirrored picture in KV (lib/avatars.ts,
 *       loaded by scripts/load-avatars.ts), else the project's X profile picture live (the X
 *       handle of its invite, through unavatar.io, fetched here so visitors
 *       never contact it and the page CSP stays same-origin)
 *   404 no usable icon and no X picture (the page shows the initial), cached an hour
 *   400 not a domain source this site reads
 *
 * The edge caches each answer under the canonical source alone, so extra
 * query parameters cannot make it fetch again. The response can never be run
 * as a document: nosniff, a sniffed image type, and a CSP of default-src 'none'.
 */
import { proofHostAllowed } from "../../src/lib/proof-fetch";
import { findSiteIcon, findXAvatar, type SiteIcon } from "../../src/lib/site-icon";
import { normalizeSource } from "../../src/lib/verified-builders";
import { edgeCache } from "./http";

export const ICON_CACHE_S = 24 * 3600;
export const ICON_MISS_CACHE_S = 3600;

const SAFE = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "cross-origin-resource-policy": "same-site" };

export interface IconHandlerDeps {
  find?: (source: string) => Promise<SiteIcon | null>;
  /** The picture mirrored in KV (avatar:<source>); absent = no mirror. */
  mirror?: (source: string) => Promise<SiteIcon | null>;
  /** The project's X handle ("@name"), from its invite; absent = no X fallback. */
  xHandleOf?: (source: string) => Promise<string | null>;
  findX?: (handle: string) => Promise<SiteIcon | null>;
  cache?: Cache | null;
  waitUntil?: (p: Promise<unknown>) => void;
}

/** The canonical domain source a request asks for, or null. */
export function iconApiSource(requestUrl: string): string | null {
  let raw: string | null;
  try {
    raw = new URL(requestUrl).searchParams.get("source");
  } catch {
    return null;
  }
  const source = raw ? normalizeSource(raw) : null;
  if (!source || !source.startsWith("domain:") || !proofHostAllowed(source.slice(7))) return null;
  return source;
}

export async function handleIcon(req: Request, deps: IconHandlerDeps = {}): Promise<Response> {
  const source = iconApiSource(req.url);
  if (!source) return new Response("not a domain source", { status: 400, headers: { ...SAFE, "cache-control": "public, max-age=3600" } });
  const cache = deps.cache === undefined ? edgeCache() : deps.cache;
  const key = new Request(`${new URL(req.url).origin}/api/icon?source=${encodeURIComponent(source)}`, { method: "GET" });
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;

  const icon = (await (deps.find ?? findSiteIcon)(source)) ?? (await mirrored(source, deps)) ?? (await xFallback(source, deps));
  const res = icon
    ? new Response(icon.bytes as unknown as BodyInit, { status: 200, headers: { ...SAFE, "content-type": icon.type, "cache-control": `public, max-age=${ICON_CACHE_S}` } })
    : new Response("no icon", { status: 404, headers: { ...SAFE, "content-type": "text/plain", "cache-control": `public, max-age=${ICON_MISS_CACHE_S}` } });
  if (cache) {
    const put = cache.put(key, res.clone());
    if (deps.waitUntil) deps.waitUntil(put);
    else await put;
  }
  return res;
}

/** The X picture of the project behind a source, or null (no handle, no picture, or any failure). */
async function xFallback(source: string, deps: IconHandlerDeps): Promise<SiteIcon | null> {
  if (!deps.xHandleOf) return null;
  try {
    const handle = await deps.xHandleOf(source);
    return handle ? await (deps.findX ?? findXAvatar)(handle) : null;
  } catch {
    return null;
  }
}

/** The KV-mirrored picture of a source, or null (none, or a failed read: the live lookup follows). */
async function mirrored(source: string, deps: IconHandlerDeps): Promise<SiteIcon | null> {
  if (!deps.mirror) return null;
  try {
    return await deps.mirror(source);
  } catch {
    return null;
  }
}
