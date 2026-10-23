/**
 * Arc apps over the last 7 days (spec docs/superpowers/specs/2026-10-22-arc-question-pages-design.md): the 168 closed
 * AEI hours ending at the last close, summed per member. Only new_payers adds up across hours; hourly wallet counts are
 * never summed. Names and categories come from the directory when an entry claims the id, else from the AEI file.
 */
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import { appHref } from "./app-href";
import { dataUntil, indexFile } from "./data-api";
import { isoHour } from "./data-api-rows";
import type { Env } from "./env";
import { edgeCache, type EdgeCacheDeps } from "./http";

export const WINDOW_H = 168;
export type WeekApp = { id: string; name: string; href: string; category: string | null; usd: number; payments: number; new_payers: number; first_hour: number | null };
export type ArcWeek = { until_hour: number; until: string; apps: WeekApp[] };
const KEY = "https://builder.registrai.cc/__internal/arc-week";
const TTL_S = 600;
const round2 = (x: number) => Math.round(x * 100) / 100;

export async function computeArcWeek(env: Env): Promise<ArcWeek | null> {
  const db = env.DATA_DB;
  if (!db) return null;
  try {
    const until = await dataUntil(db, "aei");
    if (until === null) return null;
    const [rows, aei] = await Promise.all([
      db.prepare(`SELECT m.id AS id, SUM(m.usdc) AS usd, SUM(m.payments) AS payments, SUM(m.new_payers) AS new_payers, f.first_hour AS first_hour
        FROM member_hour m LEFT JOIN member_first f ON f.idx = m.idx AND f.id = m.id
        WHERE m.idx = 'aei' AND m.hour > ?1 - ${WINDOW_H} AND m.hour <= ?1 GROUP BY m.id`).bind(until).all<{ id: string; usd: number; payments: number; new_payers: number; first_hour: number | null }>(),
      indexFile(env, "aei").catch(() => null),
    ]);
    const names = new Map((aei?.projects ?? []).map((p) => [p.source, p.name]));
    const apps = rows.results.map((r): WeekApp => {
      const e = ECOSYSTEM.byIndexId.get(r.id);
      return { id: r.id, name: e?.name ?? names.get(r.id) ?? r.id, href: appHref(r.id), category: e?.category ?? null,
        usd: round2(Number(r.usd) || 0), payments: Number(r.payments) || 0, new_payers: Number(r.new_payers) || 0, first_hour: r.first_hour == null ? null : Number(r.first_hour) };
    }).sort((a, b) => b.usd - a.usd || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { until_hour: until, until: isoHour(until), apps };
  } catch { return null; }
}

/** One computation shared by the four pages and the API, for 10 minutes. */
export async function loadArcWeek(env: Env, deps: EdgeCacheDeps): Promise<ArcWeek | null> {
  const cache = deps.cache === undefined ? edgeCache() : deps.cache;
  const key = new Request(KEY);
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return (await hit.json()) as ArcWeek;
  const w = await computeArcWeek(env);
  if (w && cache) {
    const put = cache.put(key, new Response(JSON.stringify(w), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${TTL_S}` } }));
    if (deps.waitUntil) deps.waitUntil(put); else await put;
  }
  return w;
}
