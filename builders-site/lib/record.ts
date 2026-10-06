/**
 * Daily record (contract: src/lib/record.ts). KV `record:<day>` -> StoredRecord, `record:index` -> RecordEntry[] (sorted by day).
 *   POST /api/bot/record      recorder (Bearer RADAR_PUBLISH_SECRET) {day}: snapshot, immutable once written; 2 KV writes, 0 on a repeat
 *   POST /api/bot/record/tx   recorder (Bearer) {day, tx}: sets the anchor tx once (409 after); 2 KV writes
 *   GET  /api/record/<day>.json  public: the exact stored bytes, immutable for a year
 *   GET  /api/record          public: the index, edge-cached 60 s
 */
import { publicResponse } from "../../src/lib/facts";
import { canonicalise, endOfDayMs, isRecordDay, recordUrl, sha256Hex, validateRecordDay, validateTx, type RecordEntry, type StoredRecord } from "../../src/lib/record";
import type { StoredItem } from "../../src/lib/track";
import type { VerifyMap } from "../../src/lib/verify";
import { botGuard } from "./bot-auth";
import type { Env, KV } from "./env";
import { edgeCachedGet, errorJson, json, readJson, type EdgeCacheDeps } from "./http";
import { TRACK_RETRACTED_KEY } from "./track";
import { getVerify } from "./verify";

export const RECORD_INDEX_KEY = "record:index";
const recordKey = (day: string) => `record:${day}`;

async function readJsonKey<T>(kv: KV, key: string): Promise<T | null> {
  const text = await kv.get(key);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
const readIndex = async (kv: KV): Promise<RecordEntry[]> => {
  const p = await readJsonKey<unknown>(kv, RECORD_INDEX_KEY);
  return Array.isArray(p) ? (p as RecordEntry[]) : [];
};
const withEntry = (index: RecordEntry[], e: RecordEntry): RecordEntry[] =>
  [...index.filter((x) => x.day !== e.day), e].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

/** Everything public at the end of `day`: facts (embargo and re-check gate as of then) and the track record. */
async function buildSnapshot(kv: KV, day: string): Promise<Record<string, unknown>> {
  const end = endOfDayMs(day);
  const endIso = new Date(end).toISOString();
  const facts: Record<string, unknown> = {};
  let cursor: string | undefined;
  for (;;) {
    const page = await kv.list({ prefix: "facts:", cursor });
    for (const k of page.keys) {
      const p = await readJsonKey<{ source?: unknown; facts?: unknown[] }>(kv, k.name);
      if (!p || typeof p.source !== "string" || !Array.isArray(p.facts)) continue;
      const stored = p as unknown as Parameters<typeof publicResponse>[0];
      // One extra read only for sources with an embargoed fact; a check made after the day is not part of that day.
      let verify: VerifyMap | undefined;
      if (stored.facts.some((f) => f.publishAt !== undefined)) {
        verify = Object.fromEntries(Object.entries(await getVerify(kv, stored.source)).filter(([, e]) => typeof e.lastOk === "string" && e.lastOk <= endIso));
      }
      const shown = publicResponse(stored, end, verify);
      if (shown.facts.length > 0) facts[stored.source] = shown;
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  const d = new Date(end);
  const months = [d.toISOString().slice(0, 7), new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)];
  const [a, b, retractedRaw] = await Promise.all([
    readJsonKey<{ items?: StoredItem[] }>(kv, `track:${months[0]}`),
    readJsonKey<{ items?: StoredItem[] }>(kv, `track:${months[1]}`),
    readJsonKey<Record<string, { at: string; reason: string }>>(kv, TRACK_RETRACTED_KEY),
  ]);
  const retracted = retractedRaw && typeof retractedRaw === "object" && !Array.isArray(retractedRaw) ? retractedRaw : {};
  const track = [...(b?.items ?? []), ...(a?.items ?? [])]
    .filter((i) => typeof i.publishedAt === "string" && Date.parse(i.publishedAt) <= end)
    .map((i) => {
      const { retracted: _r, ...base } = i;
      void _r;
      const r = Object.hasOwn(retracted, i.id) ? retracted[i.id] : undefined;
      return r && Date.parse(r.at) <= end ? { ...base, retracted: r } : base;
    })
    .sort((x, y) => (x.alertTime < y.alertTime ? 1 : x.alertTime > y.alertTime ? -1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { day, facts, track };
}

export async function handleBotRecord(req: Request, env: Env, nowMs = Date.now()): Promise<Response> {
  const refused = botGuard(req, env, "POST", "record snapshots");
  if (refused) return refused;
  const body = await readJson(req);
  const day = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>).day : undefined;
  const bad = validateRecordDay(day, nowMs);
  if (bad) return errorJson(400, bad);
  const d = day as string;
  const kv = env.INVITES;
  const existing = await readJsonKey<StoredRecord>(kv, recordKey(d));
  if (existing) {
    // Immutable: answer with what is stored; only repair a missing index entry (a failed second write).
    const index = await readIndex(kv);
    if (!index.some((e) => e.day === d)) await kv.put(RECORD_INDEX_KEY, JSON.stringify(withEntry(index, { day: d, digest: existing.digest, tx: existing.tx })));
    return json({ day: d, digest: existing.digest, url: recordUrl(d) });
  }
  const text = canonicalise(await buildSnapshot(kv, d));
  const digest = await sha256Hex(text);
  const rec: StoredRecord = { json: text, digest, tx: null, createdAt: new Date(nowMs).toISOString() };
  await kv.put(recordKey(d), JSON.stringify(rec));
  await kv.put(RECORD_INDEX_KEY, JSON.stringify(withEntry(await readIndex(kv), { day: d, digest, tx: null })));
  return json({ day: d, digest, url: recordUrl(d) });
}

export async function handleBotRecordTx(req: Request, env: Env): Promise<Response> {
  const refused = botGuard(req, env, "POST", "record snapshots");
  if (refused) return refused;
  const body = await readJson(req);
  const b = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (!isRecordDay(b.day)) return errorJson(400, "day must be a date, YYYY-MM-DD");
  const tx = validateTx(b.tx);
  if (!tx) return errorJson(400, "tx must be a 32-byte hex hash (0x…)");
  const kv = env.INVITES;
  const rec = await readJsonKey<StoredRecord>(kv, recordKey(b.day));
  if (!rec) return errorJson(404, "no record for that day");
  if (rec.tx !== null) return errorJson(409, "tx already set for that day", { tx: rec.tx });
  await kv.put(recordKey(b.day), JSON.stringify({ ...rec, tx }));
  await kv.put(RECORD_INDEX_KEY, JSON.stringify(withEntry(await readIndex(kv), { day: b.day, digest: rec.digest, tx })));
  return json({ day: b.day, digest: rec.digest, tx });
}

/** `dayParam` is the catch-all segment: "<day>.json", or empty for the index. */
export async function handlePublicRecord(req: Request, env: Env, dayParam: string | string[] | undefined, deps: EdgeCacheDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const seg = Array.isArray(dayParam) ? dayParam.join("/") : (dayParam ?? "");
  if (seg === "") return edgeCachedGet(req, deps, async () => json(await readIndex(env.INVITES), 200, { "cache-control": "public, max-age=60" }));
  const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(seg);
  if (!m || !isRecordDay(m[1])) return errorJson(404, "not found");
  const rec = await readJsonKey<StoredRecord>(env.INVITES, recordKey(m[1]));
  if (!rec || typeof rec.json !== "string") return errorJson(404, "not found");
  return new Response(rec.json, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "public, max-age=31536000, immutable" },
  });
}
