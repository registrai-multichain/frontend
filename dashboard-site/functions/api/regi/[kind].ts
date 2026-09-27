import { handleRegiSupply, withLastGood, type KeptCache } from "../../../lib/supply";

/**
 * GET /api/regi/circulating-supply | total-supply | supply (dashboard.registrai.cc).
 * Good answers are kept 60 s at the edge, so pollers don't each hit the Arc RPC, and
 * the last good one stands in (marked stale) when the shared public RPC refuses us.
 */
export const onRequestGet = async ({ request, params, waitUntil }: { request: Request; params: { kind?: string | string[] }; waitUntil: (p: Promise<unknown>) => void }) => {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const kind = typeof params.kind === "string" ? params.kind : "";
  if (!cache) return handleRegiSupply(kind);
  const key = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await withLastGood(cache as unknown as KeptCache, request, () => handleRegiSupply(kind));
  if (res.status === 200 && !res.headers.get("x-registrai-stale")) {
    const stored = new Response(res.clone().body, res);
    stored.headers.set("cache-control", "public, max-age=60");
    waitUntil(cache.put(key, stored));
  }
  return res;
};
