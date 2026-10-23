/**
 * Registrai Data API v1 (spec docs/superpowers/specs/2026-10-14-data-api-v1-design.md): public, read-only, versioned.
 * History from DATA_DB (registrai-data), current state from the KV index files. CORS *, sha256 etag (304 on match),
 * edge-cached 60 s with a cache variant built from VALIDATED params only.
 */
import { ABI_INDICES, sha256Hex, type AbiData } from "../../src/lib/builders-index";
import { ATTRIBUTION } from "./attribution";
import { hourOf, isoHour, INDEX_IDS, type IndexId } from "./data-api-rows";
import { verifiedIds } from "./data-api-verified";
import type { D1Database, Env } from "./env";
import { edgeCachedGet, type EdgeCacheDeps } from "./http";

export const V1_CACHE_S = 60;
export const INDEX_CAP_H = 744;
export const MEMBERS_HOURLY_CAP_H = 168;
const BASE_DATE = "2026-10-02T00:00:00Z";
const NAMES: Record<IndexId, string> = { abi: "Arc Builders Index", aii: "Arc Integrations Index", aei: "Arc Ecosystem Index" };
const HEADERS = { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "access-control-allow-origin": "*" };

export const v1Error = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...HEADERS, "cache-control": "no-store" } });

/** RFC 9110 weak comparison: `*`, a comma list, and W/ on either side (Cloudflare weakens strong etags when it compresses). */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const bare = (t: string) => t.trim().replace(/^W\//, "");
  return header.trim() === "*" || header.split(",").some((t) => bare(t) === bare(etag));
}

/** A v1 JSON response: version first, sha256 etag, 304 when if-none-match matches. */
export async function v1Json(req: Request, body: Record<string, unknown>, maxAge = V1_CACHE_S): Promise<Response> {
  const text = JSON.stringify({ version: 1, attribution: ATTRIBUTION, ...body });
  const etag = `"${await sha256Hex(text)}"`;
  if (etagMatches(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers: { ...HEADERS, etag } });
  return new Response(text, { status: 200, headers: { ...HEADERS, etag, "cache-control": `public, max-age=${maxAge}` } });
}

/** edgeCachedGet, then the 304 check again (a cache hit returns the stored 200 as is). */
export async function cached(req: Request, deps: EdgeCacheDeps, variant: string, produce: () => Promise<Response>, ttl = V1_CACHE_S): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return v1Error(405, "Only GET is supported.");
  const res = await edgeCachedGet(req, deps, produce, ttl, variant);
  const etag = res.headers.get("etag");
  if (res.status === 200 && etag && etagMatches(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers: { ...HEADERS, etag } });
  return res;
}

export const parseIndex = (v: string | null): IndexId | null => (INDEX_IDS as string[]).includes(v ?? "") ? (v as IndexId) : null;

/** from/to (ISO hour closes, inclusive). Neither: the cap-long window ending at data_until; one: up to the cap from it. */
export function parseWindow(url: URL, untilHour: number, cap: number): { from: number; to: number } | { error: string } {
  const f = url.searchParams.get("from"), t = url.searchParams.get("to");
  const from = f === null ? null : hourOf(f), to = t === null ? null : hourOf(t);
  if ((f !== null && from === null) || (t !== null && to === null)) return { error: "from and to must be ISO hour closes, like 2026-10-14T19:00:00Z." };
  let a: number, b: number;
  if (from === null && to === null) { b = untilHour; a = b - cap + 1; }
  else if (from !== null && to === null) {
    if (from > untilHour) return { from, to: from - 1 };   // ahead of the data (a poller before the push): an empty window, not an error
    a = from; b = Math.min(from + cap - 1, untilHour);
  }
  else if (from === null) { b = to!; a = b - cap + 1; }
  else { a = from; b = to!; }
  if (a > b) return { error: "from must not be after to." };
  if (b - a + 1 > cap) return { error: `A request covers at most ${cap} hours.` };
  return { from: a, to: b };
}

export async function dataUntil(db: D1Database, index: IndexId): Promise<number | null> {
  const r = await db.prepare("SELECT MAX(hour) AS h FROM index_hour WHERE idx = ?").bind(index).first<{ h: number | null }>();
  return r?.h ?? null;
}

export async function indexFile(env: Env, id: IndexId): Promise<AbiData | null> {
  try { return JSON.parse((await env.INVITES.get(ABI_INDICES[id].key)) ?? "null") as AbiData | null; } catch { return null; }
}
const lastClose = (d: AbiData) => d.candles?.length ? d.candles[d.candles.length - 1][4] : null;

export function handleIndices(req: Request, env: Env, deps: EdgeCacheDeps = {}): Promise<Response> {
  return cached(req, deps, "indices", async () => {
    const files = await Promise.all(INDEX_IDS.map((id) => indexFile(env, id)));
    if (files.some((f) => !f || lastClose(f) === null || hourOf(f.data_until) === null)) return v1Error(503, "The index data is not available right now. Retry later.");
    const fs = files as AbiData[];
    const until = Math.min(...fs.map((f) => hourOf(f.data_until)!));
    const p = fs[0].params as { half_life_days: number; decay_per_hour_pct: number };
    return v1Json(req, {
      data_until: isoHour(until),
      indices: Object.fromEntries(INDEX_IDS.map((id, i) => [id, { name: NAMES[id], close: lastClose(fs[i]), close_24h_ago: fs[i].index_24h_ago, base: 1000, base_date: BASE_DATE, members: fs[i].projects.length }])),
      params: { half_life_days: p.half_life_days, decay_per_hour_pct: p.decay_per_hour_pct },
    });
  });
}

export function handleIndexHourly(req: Request, env: Env, index: IndexId, deps: EdgeCacheDeps = {}, capHours = INDEX_CAP_H): Promise<Response> {
  const url = new URL(req.url);
  return (async () => {
    const db = env.DATA_DB;
    if (!db) return v1Error(503, "History is not available right now. Retry later.");
    const until = await dataUntil(db, index);
    if (until === null) return v1Error(503, "History is not available right now. Retry later.");
    const w = parseWindow(url, until, capHours);
    if ("error" in w) return v1Error(400, w.error);
    return cached(req, deps, `ih:${index}:${w.from}:${w.to}:${until}`, async () => {
      const rows = (await db.prepare("SELECT hour, close FROM index_hour WHERE idx = ? AND hour BETWEEN ? AND ? ORDER BY hour").bind(index, w.from, w.to).all<{ hour: number; close: number }>()).results;
      return v1Json(req, { index, data_until: isoHour(until), rows: rows.map((r) => ({ hour_close: isoHour(r.hour), hour: r.hour, close: r.close })) });
    });
  })();
}
const KIND: Record<string, "builder" | "integration" | "base"> = { project: "builder", integration: "integration", base: "base" };
type MemberRow = { id: string; hour: number; points: number; points_earned: number; payments: number; wallets: number; new_payers: number; usdc: number };
const rowOut = (r: MemberRow) => ({ hour_close: isoHour(r.hour), hour: r.hour, points: r.points, points_earned: r.points_earned, payments: r.payments, wallets: r.wallets, new_payers: r.new_payers, usdc: r.usdc });
const unavailable = () => v1Error(503, "History is not available right now. Retry later.");

export async function firstHours(db: D1Database, index: IndexId): Promise<Map<string, number>> {
  const rows = (await db.prepare("SELECT id, first_hour FROM member_first WHERE idx = ?").bind(index).all<{ id: string; first_hour: number }>()).results;
  return new Map(rows.map((r) => [r.id, r.first_hour]));
}

async function memberList(env: Env, index: IndexId, deps: EdgeCacheDeps) {
  const db = env.DATA_DB, f = await indexFile(env, index);
  if (!db || !f?.live?.P) return null;
  const until = await dataUntil(db, index);
  if (until === null) return null;
  const [first, verified] = await Promise.all([firstHours(db, index), verifiedIds(env, deps)]);
  const members = f.projects.filter((p) => typeof f.live!.P[p.source] === "number").map((p) => ({
    id: p.source, name: p.name, kind: KIND[p.kind] ?? "builder", verified: verified.has(p.source), points: f.live!.P[p.source], share: p.share,
    first_hour: isoHour(first.get(p.source) ?? until),
    last_24h: { points_earned: p.pts_24h ?? 0, payments: p.pay_24h ?? 0, usdc: p.usdc_24h ?? 0 }, // older files carry no 24 h stats
  }));
  return { until, members };
}

export function handleMembers(req: Request, env: Env, index: IndexId, deps: EdgeCacheDeps = {}): Promise<Response> {
  return cached(req, deps, `m:${index}`, async () => {
    const l = await memberList(env, index, deps);
    return l ? v1Json(req, { index, data_until: isoHour(l.until), members: l.members }) : unavailable();
  });
}

export function handleMembersNew(req: Request, env: Env, index: IndexId, deps: EdgeCacheDeps = {}): Promise<Response> {
  const since = hourOf(new URL(req.url).searchParams.get("since") ?? "");
  if (since === null) return Promise.resolve(v1Error(400, "since is required, as an ISO hour close like 2026-10-14T19:00:00Z."));
  return cached(req, deps, `mn:${index}:${since}`, async () => {
    const l = await memberList(env, index, deps);
    if (!l) return unavailable();
    const fresh = l.members.filter((m) => hourOf(m.first_hour)! > since).sort((a, b) => (a.first_hour < b.first_hour ? -1 : a.first_hour > b.first_hour ? 1 : 0));
    return v1Json(req, { index, since: isoHour(since), data_until: isoHour(l.until), members: fresh });
  });
}

export function handleMemberHourly(req: Request, env: Env, index: IndexId, id: string, deps: EdgeCacheDeps = {}, capHours = INDEX_CAP_H): Promise<Response> {
  return (async () => {
    const db = env.DATA_DB;
    if (!db) return unavailable();
    const until = await dataUntil(db, index);
    if (until === null) return unavailable();
    const w = parseWindow(new URL(req.url), until, capHours);
    if ("error" in w) return v1Error(400, w.error);
    return cached(req, deps, `mh:${index}:${id}:${w.from}:${w.to}:${until}`, async () => {
      const rows = (await db.prepare("SELECT id, hour, points, points_earned, payments, wallets, new_payers, usdc FROM member_hour WHERE idx = ? AND id = ? AND hour BETWEEN ? AND ? ORDER BY hour").bind(index, id, w.from, w.to).all<MemberRow>()).results;
      if (!rows.length) {
        const known = await db.prepare("SELECT 1 AS x FROM member_hour WHERE idx = ? AND id = ? LIMIT 1").bind(index, id).first();
        if (!known) return v1Error(404, "Unknown member for this index.");
      }
      return v1Json(req, { index, id, data_until: isoHour(until), rows: rows.map(rowOut) });
    });
  })();
}

export function handleMembersHourly(req: Request, env: Env, index: IndexId, deps: EdgeCacheDeps = {}): Promise<Response> {
  return (async () => {
    const db = env.DATA_DB;
    if (!db) return unavailable();
    const until = await dataUntil(db, index);
    if (until === null) return unavailable();
    const url = new URL(req.url), hourParam = url.searchParams.get("hour");
    let w: { from: number; to: number } | { error: string };
    if (hourParam !== null) {
      const h = hourOf(hourParam);
      if (url.searchParams.has("from") || url.searchParams.has("to")) w = { error: "Use hour, or from and to, not both." };
      else w = h === null ? { error: "hour must be an ISO hour close, like 2026-10-14T19:00:00Z." } : { from: h, to: h };
    } else w = parseWindow(url, until, MEMBERS_HOURLY_CAP_H);
    if ("error" in w) return v1Error(400, w.error);
    return cached(req, deps, `msh:${index}:${w.from}:${w.to}:${until}`, async () => {
      const rows = (await db.prepare("SELECT id, hour, points, points_earned, payments, wallets, new_payers, usdc FROM member_hour WHERE idx = ? AND hour BETWEEN ? AND ? ORDER BY hour, id").bind(index, w.from, w.to).all<MemberRow>()).results;
      return v1Json(req, { index, data_until: isoHour(until), rows: rows.map((r) => ({ id: r.id, ...rowOut(r) })) });
    });
  })();
}
