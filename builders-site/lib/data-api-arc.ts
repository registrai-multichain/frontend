/** GET /api/v1/arc (live Arc in numbers, cached 10 min), /api/v1/arc/daily?days= (daily snapshots, newest first) and
 *  /api/v1/arc/apps-week (apps over the last 168 closed AEI hours). */
import { collectArcNumbers } from "./arc-numbers";
import { clampDays, readArcDaily } from "./arc-daily";
import { loadArcWeek, WINDOW_H } from "./arc-week";
import { share7d } from "./arc-share";
import { isoHour } from "./data-api-rows";
import { cached, v1Error, v1Json } from "./data-api";
import type { Env } from "./env";
import type { EdgeCacheDeps } from "./http";

export function handleArc(req: Request, env: Env, deps: EdgeCacheDeps, parts: string[], fetcher: typeof fetch = fetch): Promise<Response> {
  if (parts.length === 0) return cached(req, deps, "arc", async () => {
    const [n, days] = await Promise.all([collectArcNumbers(env, fetcher), env.DATA_DB ? readArcDaily(env.DATA_DB, 7).catch(() => []) : Promise.resolve([])]);
    return v1Json(req, { ...n, attributed_share_7d: share7d(days) }, 600);
  }, 600);
  if (parts.length === 1 && parts[0] === "daily") {
    if (!env.DATA_DB) return Promise.resolve(v1Error(503, "The history is not available right now. Retry later."));
    const days = clampDays(new URL(req.url).searchParams.get("days"));
    return cached(req, deps, `arc-daily:${days}`, async () => {
      try { return await v1Json(req, { days: await readArcDaily(env.DATA_DB!, days) }, 600); } catch { return v1Error(503, "The history is not available right now. Retry later."); }
    }, 600);
  }
  if (parts.length === 1 && parts[0] === "apps-week") {
    return cached(req, deps, "arc-apps-week", async () => {
      const w = await loadArcWeek(env, deps);
      // first_hour as an ISO hour like /members, and an absolute page URL (review #6)
      const apps = w?.apps.map(({ href, first_hour, ...a }) => ({ ...a, url: `https://builder.registrai.cc${href}`, first_hour: first_hour === null ? null : isoHour(first_hour) }));
      return w ? v1Json(req, { version: 1, until: w.until, window_hours: WINDOW_H, apps: apps! }, 600) : v1Error(503, "Weekly data is not available right now.");
    }, 600);
  }
  return Promise.resolve(v1Error(404, "Not found. Use /api/v1/arc, /api/v1/arc/daily or /api/v1/arc/apps-week."));
}
