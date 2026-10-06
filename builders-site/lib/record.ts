/**
 * Daily record (contract: src/lib/record.ts). KV `record:<day>` -> StoredRecord, `record:index` -> RecordEntry[] (sorted by day).
 *   POST /api/bot/record      recorder (Bearer RADAR_PUBLISH_SECRET) {day = today UTC}: snapshot of the public state now, immutable once written; 2 KV writes, 0 on a repeat
 *   POST /api/bot/record/tx   recorder (Bearer) {day, tx}: sets the anchor tx once (409 after); 2 KV writes
 *   GET  /api/record/<day>.json  public: the exact stored bytes, immutable for a year
 *   GET  /api/record          public: the index, edge-cached 60 s
 */
import { publicResponse, type ProjectFacts } from "../../src/lib/facts";
import { canonicalise, isRecordDay, recordUrl, sha256Hex, validateRecordDay, validateTx, type RecordEntry, type StoredRecord } from "../../src/lib/record";
import { botGuard } from "./bot-auth";
import type { Env, KV } from "./env";
import { edgeCachedGet, errorJson, json, readJson, type EdgeCacheDeps } from "./http";
import { FACTS_KEY_PREFIX, listNames, MAX_SOURCES, mapChunks } from "./kv-chunks";
import { publicTrackItems, readMonth, readRetractions } from "./track";
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

/** The public state right now: each source exactly as GET /api/facts/<source> answers, the track exactly as GET /api/track items (all months). */
async function buildSnapshot(kv: KV, day: string, nowMs: number): Promise<Record<string, unknown> | null> {
  const names = await listNames(kv, FACTS_KEY_PREFIX);
  if (names.length > MAX_SOURCES) return null;
  const facts: Record<string, unknown> = {};
  const rows = await mapChunks(names, async (name) => {
    const stored = await readJsonKey<{ source?: unknown; facts?: unknown }>(kv, name);
    if (!stored || typeof stored.source !== "string" || !Array.isArray(stored.facts)) return null;
    return { source: stored.source, shown: publicResponse(stored as unknown as ProjectFacts, nowMs, await getVerify(kv, stored.source)) };
  });
  for (const r of rows) if (r) facts[r.source] = r.shown;
  const months = await listNames(kv, "track:20");
  const lists = await mapChunks(months, (m) => readMonth(kv, m));
  const [retracted, verify] = await Promise.all([readRetractions(kv), getVerify(kv, "track")]);
  return { day, takenAt: new Date(nowMs).toISOString(), facts, track: publicTrackItems(lists.flat(), retracted, verify) };
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
  const snap = await buildSnapshot(kv, d, nowMs);
  if (!snap) return errorJson(507, "too many sources");
  let text: string;
  try {
    text = canonicalise(snap);
  } catch {
    return errorJson(500, "snapshot could not be canonicalised");
  }
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
