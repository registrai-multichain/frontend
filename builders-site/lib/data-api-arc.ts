/** GET /api/v1/arc (live Arc in numbers, cached 10 min) and /api/v1/arc/daily?days= (daily snapshots, newest first). */
import { collectArcNumbers } from "./arc-numbers";
import { clampDays, readArcDaily } from "./arc-daily";
import { cached, v1Error, v1Json } from "./data-api";
import type { Env } from "./env";
import type { EdgeCacheDeps } from "./http";

export function handleArc(req: Request, env: Env, deps: EdgeCacheDeps, parts: string[]): Promise<Response> {
  if (parts.length === 0) return cached(req, deps, "arc", async () => v1Json(req, { ...(await collectArcNumbers(env)) }, 600), 600);
  if (parts.length === 1 && parts[0] === "daily") {
    if (!env.DATA_DB) return Promise.resolve(v1Error(503, "The history is not available right now. Retry later."));
    const days = clampDays(new URL(req.url).searchParams.get("days"));
    return cached(req, deps, `arc-daily:${days}`, async () => {
      try { return await v1Json(req, { days: await readArcDaily(env.DATA_DB!, days) }, 600); } catch { return v1Error(503, "The history is not available right now. Retry later."); }
    }, 600);
  }
  return Promise.resolve(v1Error(404, "Not found. Use /api/v1/arc or /api/v1/arc/daily."));
}
