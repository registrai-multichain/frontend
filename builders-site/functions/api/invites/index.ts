import type { PagesFunction } from "../../../lib/env";
import { edgeCache } from "../../../lib/http";
import { handlePublicInvites, invitesCacheKey } from "../../../lib/invites";

/** GET /api/invites — public fields only; the edge keeps it 60 s under one key (the query string is ignored). */
export const onRequestGet: PagesFunction = async (ctx) => {
  const cache = edgeCache();
  const key = new Request(invitesCacheKey(ctx.request.url), { method: "GET" });
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  const res = await handlePublicInvites(ctx.env);
  if (cache) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
};
