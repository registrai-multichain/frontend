import { handleRegiSupply } from "../../../lib/supply";

/**
 * GET /api/regi/circulating-supply | total-supply | supply (dashboard.registrai.cc).
 * Good answers are kept 60 s at the edge, so pollers don't each hit the Arc RPC.
 */
export const onRequestGet = async ({ request, params, waitUntil }: { request: Request; params: { kind?: string | string[] }; waitUntil: (p: Promise<unknown>) => void }) => {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  const res = await handleRegiSupply(typeof params.kind === "string" ? params.kind : "");
  if (cache && res.status === 200) {
    const stored = new Response(res.clone().body, res);
    stored.headers.set("cache-control", "public, max-age=60");
    waitUntil(cache.put(key, stored));
  }
  return res;
};
