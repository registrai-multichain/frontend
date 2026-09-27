import type { PagesFunction } from "../../../lib/env";
import { edgeCache } from "../../../lib/http";
import { feedCacheKey, handleApprovedFeed } from "../../../lib/market-proposals";

/** GET /api/market-proposals/approved — the rounds agent's feed (the signature is the authority).
 *  One KV read, kept 30 s at the edge under one key (the query string is ignored). */
export const onRequestGet: PagesFunction = async (ctx) => {
  const cache = edgeCache();
  const key = new Request(feedCacheKey(ctx.request.url), { method: "GET" });
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  const res = await handleApprovedFeed(ctx.request, ctx.env);
  // Only a built feed is cached (a missing doc answers no-store until POST /rebuild).
  if (cache && res.ok && (res.headers.get("cache-control") ?? "").startsWith("public")) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
};
