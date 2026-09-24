import type { PagesFunction } from "../../../lib/env";
import { edgeCache } from "../../../lib/http";
import { handlePublicInvites } from "../../../lib/invites";

/** GET /api/invites — public fields only; the edge keeps it 60 s. */
export const onRequestGet: PagesFunction = async (ctx) => {
  const cache = edgeCache();
  const hit = cache ? await cache.match(ctx.request) : undefined;
  if (hit) return hit;
  const res = await handlePublicInvites(ctx.env);
  if (cache) ctx.waitUntil(cache.put(ctx.request, res.clone()));
  return res;
};
