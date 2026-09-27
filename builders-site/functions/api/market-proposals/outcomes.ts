import type { PagesFunction } from "../../../lib/env";
import { edgeCache } from "../../../lib/http";
import { feedCacheKey, handleOutcomesFeed } from "../../../lib/market-proposals";

/** GET /api/market-proposals/outcomes — the rounds agent's signed-outcome feed. One KV read,
 *  kept 30 s at the edge under one key (the query string is ignored). */
export const onRequestGet: PagesFunction = async (ctx) => {
  const cache = edgeCache();
  const key = new Request(feedCacheKey(ctx.request.url), { method: "GET" });
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  const res = await handleOutcomesFeed(ctx.request, ctx.env);
  if (cache && res.ok) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
};
