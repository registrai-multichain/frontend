/**
 * Public track record (contract: src/lib/track.ts). KV `track:<yyyy-mm>` -> { items: StoredItem[] }, `track:meta` -> { watching, updatedAt }.
 *   POST /api/bot/track            radar keeper (Bearer RADAR_PUBLISH_SECRET): a batch; at most 3 KV writes (2 months + meta)
 *   GET  /api/track                public; reads the current and previous month plus track:retracted, never writes; edge-cached 60 s
 *   POST /api/admin/track/retract  admin: records the retraction in track:retracted only (month records untouched); one write
 */
import { describesOnly, mergeMonth, monthKey, trackStats, TRACK_LIMITS, validateBatch, type StoredItem, type TrackItem } from "../../src/lib/track";
import { safeEqual } from "../../src/lib/builders-admin";
import { ONBOARDER_READ_ONLY, type Role } from "./auth";
import type { Env, KV } from "./env";
import { edgeCachedGet, errorJson, json, readJson, type EdgeCacheDeps } from "./http";

export const TRACK_META_KEY = "track:meta";
/** `{ "<id>": { at, reason } }`: kept apart from the month records so a publish can never undo a retraction. */
export const TRACK_RETRACTED_KEY = "track:retracted";
type Retractions = Record<string, { at: string; reason: string }>;

async function readRetractions(kv: KV): Promise<Retractions> {
  const text = await kv.get(TRACK_RETRACTED_KEY);
  if (!text) return {};
  try {
    const p = JSON.parse(text) as unknown;
    return typeof p === "object" && p !== null && !Array.isArray(p) ? (p as Retractions) : {};
  } catch {
    return {};
  }
}
const PUBLIC_MAX_ITEMS = 500;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID_RE = /^[0-9a-f]{64}$/;

async function readMonth(kv: KV, key: string): Promise<StoredItem[]> {
  const text = await kv.get(key);
  if (!text) return [];
  try {
    const p = JSON.parse(text) as { items?: unknown };
    return p && Array.isArray(p.items) ? (p.items as StoredItem[]) : [];
  } catch {
    return [];
  }
}

export async function handleBotTrack(req: Request, env: Env, nowMs = Date.now()): Promise<Response> {
  const secret = env.RADAR_PUBLISH_SECRET ?? "";
  if (secret.length < 32) return errorJson(503, "track publishing is not configured");
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !safeEqual(token, secret)) return errorJson(401, "unauthorized");
  if (req.method.toUpperCase() !== "POST") return errorJson(405, "method not allowed");
  const v = validateBatch(await readJson(req), nowMs);
  if (!v.ok) return errorJson(400, v.error);
  const groups = new Map<string, TrackItem[]>();
  for (const it of v.items) {
    const k = monthKey(it.alertTime);
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  if (groups.size > 2) return errorJson(400, "a batch may span at most 2 months");
  const nowIso = new Date(nowMs).toISOString();
  let stored = 0;
  for (const [k, incoming] of groups) {
    const existing = await readMonth(env.INVITES, k);
    const merged = mergeMonth(existing, incoming, nowIso);
    const have = new Set(existing.map((e) => e.id));
    stored += new Set(incoming.filter((i) => !have.has(i.id)).map((i) => i.id)).size;
    await env.INVITES.put(k, JSON.stringify({ items: merged }));
  }
  await env.INVITES.put(TRACK_META_KEY, JSON.stringify({ watching: v.watching, updatedAt: nowIso }));
  return json({ ok: true, stored });
}

function monthsOf(nowMs: number): string[] {
  const d = new Date(nowMs);
  const cur = d.toISOString().slice(0, 7);
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  return [cur, prev];
}

export async function handlePublicTrack(req: Request, env: Env, deps: { now?: number } & EdgeCacheDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const now = deps.now ?? Date.now();
  return edgeCachedGet(req, deps, async () => {
    const [cur, prev] = monthsOf(now);
    const [a, b, metaText, retracted] = await Promise.all([readMonth(env.INVITES, `track:${cur}`), readMonth(env.INVITES, `track:${prev}`), env.INVITES.get(TRACK_META_KEY), readRetractions(env.INVITES)]);
    let meta: { watching?: unknown; updatedAt?: unknown } = {};
    try {
      meta = metaText ? (JSON.parse(metaText) as typeof meta) : {};
    } catch {
      /* unreadable meta reads as empty */
    }
    const all = [...b, ...a].map((i) => (Object.hasOwn(retracted, i.id) ? { ...i, retracted: retracted[i.id] } : i));
    const items = [...all].sort((x, y) => (x.alertTime < y.alertTime ? 1 : x.alertTime > y.alertTime ? -1 : 0)).slice(0, PUBLIC_MAX_ITEMS);
    return json(
      {
        watching: typeof meta.watching === "number" ? meta.watching : 0,
        updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : null,
        stats: trackStats(all, now),
        items,
      },
      200,
      { "cache-control": "public, max-age=60" },
    );
  });
}

export async function handleAdminTrackRetract(req: Request, env: Env, admin: string, role: Role | undefined, nowMs = Date.now()): Promise<Response> {
  if (req.method.toUpperCase() !== "POST") return errorJson(405, "method not allowed");
  if (role !== "admin") return errorJson(403, ONBOARDER_READ_ONLY);
  const body = await readJson(req);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return errorJson(400, "expected a JSON object");
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || !ID_RE.test(b.id)) return errorJson(400, "id must be 64 lowercase hex characters");
  if (typeof b.month !== "string" || !MONTH_RE.test(b.month)) return errorJson(400, "month must be YYYY-MM");
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (reason.length < 1 || reason.length > TRACK_LIMITS.reason) return errorJson(400, `reason must be 1 to ${TRACK_LIMITS.reason} characters`);
  if (!describesOnly(reason)) return errorJson(400, "reason must describe, not judge (banned word found)");
  void admin;
  const key = `track:${b.month}`;
  const items = await readMonth(env.INVITES, key);
  const i = items.findIndex((x) => x.id === b.id);
  if (i < 0) return errorJson(404, "no such item in that month");
  const retractions = await readRetractions(env.INVITES);
  if (Object.hasOwn(retractions, b.id)) return errorJson(409, "already retracted");
  const retracted = { at: new Date(nowMs).toISOString(), reason };
  retractions[b.id] = retracted;
  await env.INVITES.put(TRACK_RETRACTED_KEY, JSON.stringify(retractions));
  const updated: StoredItem = { ...items[i], retracted };
  return json({ item: updated });
}
