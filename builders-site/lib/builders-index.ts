/**
 * Arc indices (contract: src/lib/builders-index.ts; spec §17: ABI, AII, AEI). Two KV values per index on INVITES:
 *   <id>:index  the validated index file (series, members, events, and the `live` block the browser replays from)
 *   <id>:seen   the wallets seen before the open hour (same hour_start as the index file's live block)
 *   POST /api/index[/aii|/aei], POST …/seen   producer (Bearer ABI_PUSH_TOKEN): validates, one KV write each; a file
 *                                             older than the stored one is refused with 409 (audit SS-6)
 *   GET  the same paths                       public; reads one key, never writes; edge-cached 30 s; 404 {error:"no data"} when empty
 */
import { ABI_INDEX_IDS, ABI_INDICES, ABI_LIMITS, ABI_SUMMARY_SPARK_HOURS, canonicalJson, sha256Hex, validateContracts, validateIndex, validateSeen, type AbiIndexId, type AbiIndexSummary } from "../../src/lib/builders-index";
import { bearerGuard } from "./bot-auth";
import { ingestIndexFile } from "./data-api-ingest";
import { storeAppContracts } from "./app-contracts";
import { pingIndexNow, shouldPing, sitemapUrls } from "./sitemap-urls";
import { snapshotArcDaily } from "./arc-daily";
import { purgeCorrections } from "./corrections";
import type { Env } from "./env";
import { edgeCachedGet, errorJson, json, type EdgeCacheDeps } from "./http";

export const ABI_CACHE_S = 30;

/** The body as text, counting bytes as they arrive; null as soon as it exceeds maxBytes (nothing past the limit is buffered). */
export async function readCapped(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(all);
}

type Checked<D> = { ok: true; data: D } | { ok: false; error: string };

/**
 * Audit SS-6: what ranks the files of one key (index: data_until, seen and contracts: hour_start). A post older
 * than the stored file is refused (a delayed retry or a second writer must not move the published file back); an
 * equal one is accepted, because producers re-post and restate the same hour.
 */
interface Rank<D> {
  field: string;
  of: (x: D | Record<string, unknown>) => number | null;
}
const hourStartRank: Rank<{ hour_start: number }> = {
  field: "hour_start",
  of: (x) => (typeof x.hour_start === "number" && Number.isFinite(x.hour_start) ? x.hour_start : null),
};
const dataUntilRank: Rank<{ data_until: string }> = {
  field: "data_until",
  of: (x) => {
    const t = typeof x.data_until === "string" ? Date.parse(x.data_until) : NaN;
    return Number.isFinite(t) ? t : null;
  },
};

/** The stored file's rank; null when there is none or it can't be read (then any valid post is taken). */
async function storedRank<D>(env: Env, key: string, rank: Rank<D>): Promise<number | null> {
  try {
    const text = await env.INVITES.get(key);
    if (!text) return null;
    const stored = JSON.parse(text) as unknown;
    return typeof stored === "object" && stored !== null ? rank.of(stored as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function push<D>(req: Request, env: Env, key: string, maxBytes: number, validate: (raw: unknown) => Checked<D>, summary: (data: D) => Record<string, unknown>, rank: Rank<D>, finalize?: (data: D) => Promise<void>, after?: (data: D) => Promise<unknown>): Promise<Response> {
  const refused = bearerGuard(req, env.ABI_PUSH_TOKEN, "POST", "index publishing");
  if (refused) return refused;
  const header = req.headers.get("content-length");
  if (header !== null) {
    const declared = Number(header);
    if (!Number.isInteger(declared) || declared < 0) return errorJson(400, "invalid content-length");
    if (declared > maxBytes) return errorJson(413, `body must be at most ${maxBytes} bytes`);
  }
  const text = await readCapped(req, maxBytes);
  if (text === null) return errorJson(413, `body must be at most ${maxBytes} bytes`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return errorJson(400, "body must be JSON");
  }
  const v = validate(body);
  if (!v.ok) return errorJson(400, v.error);
  const incoming = rank.of(v.data), stored = await storedRank(env, key, rank);
  if (incoming !== null && stored !== null && incoming < stored) {
    return errorJson(409, `${rank.field} is older than the stored file's`, { stored: rank.field === "data_until" ? new Date(stored).toISOString() : stored });
  }
  if (finalize) await finalize(v.data);
  await env.INVITES.put(key, JSON.stringify(v.data));
  if (after) await after(v.data);
  return json({ ok: true, ...summary(v.data) });
}

export const handlePushIndex = (req: Request, env: Env, id: AbiIndexId = "abi", deps: { waitUntil?: (p: Promise<unknown>) => void } = {}) =>
  push(req, env, ABI_INDICES[id].key, ABI_LIMITS.bytes, validateIndex, (d) => ({ index: id, updated: d.updated, points: d.series.length }), dataUntilRank, undefined,
    async (d) => {
      await ingestIndexFile(env.DATA_DB, id, d); // Data API v1 history; never fails the publish
      // once a day, after the 00:00 UTC close: tell IndexNow engines the data pages changed (best effort)
      if (id === "aei" && shouldPing(d.data_until)) {
        // after the response when the runtime allows (waitUntil): the keeper waits 30 s for this post, and a slow RPC or
        // DefiLlama must never turn its 00:00 close into a failure
        const later = (async () => {
          await snapshotArcDaily(env, d.data_until.slice(0, 10), { aei: d as never }); // Arc in numbers: one fixed snapshot per day
          if (env.DATA_DB) await purgeCorrections(env.DATA_DB).catch(() => 0);   // corrections: 30-day privacy purge, once a day
          await pingIndexNow((await sitemapUrls(env, {}).catch(() => [])).map((u) => u.loc));
        })().catch(() => undefined);
        if (deps.waitUntil) deps.waitUntil(later); else await later;
      }
    });

export const handlePushSeen = (req: Request, env: Env, id: AbiIndexId = "abi") =>
  push(req, env, ABI_INDICES[id].seenKey, ABI_INDICES[id].seenBytes, validateSeen, (d) => ({ index: id, hour_start: d.hour_start, sources: Object.keys(d.seen).length }), hourStartRank);

/** POST …/contracts: the index's contract map. The site stores it with the sha256 of its canonical JSON, which the
 * index file pins (live.contracts_sha256), so a browser never pairs an index with the wrong map. */
export async function handlePushContracts(req: Request, env: Env, id: AbiIndexId = "abi"): Promise<Response> {
  let sha = "";
  const r = await push(req, env, ABI_INDICES[id].contractsKey, ABI_LIMITS.contractsBytes, (raw) => {
    const v = validateContracts(raw);
    return v.ok ? { ok: true as const, data: { ...v.data, sha256: "" } } : v;
  }, (d) => ({ index: id, hour_start: d.hour_start, contracts: Object.keys(d.contracts).length, sha256: sha }), hourStartRank, async (d) => {
    sha = await sha256Hex(canonicalJson({ contracts: d.contracts, open_senders: d.open_senders }));
    d.sha256 = sha;
  }, id === "aei" ? (d) => storeAppContracts(env, d.contracts) : undefined); // per-app lists for the /apps pages
  return r;
}
export const handlePublicContracts = (req: Request, env: Env, deps: EdgeCacheDeps = {}, id: AbiIndexId = "abi") => publicGet(req, env, ABI_INDICES[id].contractsKey, deps);

async function publicGet(req: Request, env: Env, key: string, deps: EdgeCacheDeps): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  return edgeCachedGet(req, deps, async () => {
    const text = await env.INVITES.get(key);
    if (!text) return errorJson(404, "no data");
    return new Response(text, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": `public, max-age=${ABI_CACHE_S}` },
    });
  }, ABI_CACHE_S);
}

export const handlePublicIndex = (req: Request, env: Env, deps: EdgeCacheDeps = {}, id: AbiIndexId = "abi") => publicGet(req, env, ABI_INDICES[id].key, deps);
export const handlePublicSeen = (req: Request, env: Env, deps: EdgeCacheDeps = {}, id: AbiIndexId = "abi") => publicGet(req, env, ABI_INDICES[id].seenKey, deps);

/** GET /api/index/summary: the last closed value of every index and its last 7 days of hourly closes (three KV
 * reads), edge-cached 30 s. The files in KV were validated on the way in; a missing or unreadable one is null.
 * Public data, so any origin may read it (the registrai.cc landing fetches it from the browser). */
export async function handleIndexSummary(req: Request, env: Env, deps: EdgeCacheDeps = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  return edgeCachedGet(req, deps, async () => {
    const out = {} as AbiIndexSummary;
    await Promise.all(ABI_INDEX_IDS.map(async (id) => {
      try {
        const d = JSON.parse((await env.INVITES.get(ABI_INDICES[id].key)) ?? "null") as { index: number; index_24h_ago?: number | null; data_until: string; series?: [string, number][] } | null;
        out[id] = d ? { index: d.index, index_24h_ago: d.index_24h_ago ?? null, data_until: d.data_until, spark: (d.series ?? []).slice(-ABI_SUMMARY_SPARK_HOURS) } : null;
      } catch {
        out[id] = null;
      }
    }));
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": `public, max-age=${ABI_CACHE_S}`, "access-control-allow-origin": "*" },
    });
  }, ABI_CACHE_S);
}
