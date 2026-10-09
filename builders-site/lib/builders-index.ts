/**
 * Arc Builders Index (contract: src/lib/builders-index.ts). Two KV values on INVITES:
 *   abi:index  the validated index file (series, members, events, and the `live` block the browser replays from)
 *   abi:seen   the wallets seen before the open hour (same hour_start as the index file's live block)
 *   POST /api/index, POST /api/index/seen   producer (Bearer ABI_PUSH_TOKEN): validates, one KV write each
 *   GET  the same paths                     public; reads one key, never writes; edge-cached 30 s; 404 {error:"no data"} when empty
 */
import { ABI_KEY, ABI_LIMITS, ABI_SEEN_KEY, validateIndex, validateSeen } from "../../src/lib/builders-index";
import { bearerGuard } from "./bot-auth";
import type { Env } from "./env";
import { edgeCachedGet, errorJson, json, type EdgeCacheDeps } from "./http";

export const ABI_CACHE_S = 30;

type Checked<D> = { ok: true; data: D } | { ok: false; error: string };

async function push<D>(req: Request, env: Env, key: string, maxBytes: number, validate: (raw: unknown) => Checked<D>, summary: (data: D) => Record<string, unknown>): Promise<Response> {
  const refused = bearerGuard(req, env.ABI_PUSH_TOKEN, "POST", "index publishing");
  if (refused) return refused;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return errorJson(413, `body must be at most ${maxBytes} bytes`);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) return errorJson(413, `body must be at most ${maxBytes} bytes`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return errorJson(400, "body must be JSON");
  }
  const v = validate(body);
  if (!v.ok) return errorJson(400, v.error);
  await env.INVITES.put(key, JSON.stringify(v.data));
  return json({ ok: true, ...summary(v.data) });
}

export const handlePushIndex = (req: Request, env: Env) =>
  push(req, env, ABI_KEY, ABI_LIMITS.bytes, validateIndex, (d) => ({ updated: d.updated, points: d.series.length }));

export const handlePushSeen = (req: Request, env: Env) =>
  push(req, env, ABI_SEEN_KEY, ABI_LIMITS.seenBytes, validateSeen, (d) => ({ hour_start: d.hour_start, sources: Object.keys(d.seen).length }));

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

export const handlePublicIndex = (req: Request, env: Env, deps: EdgeCacheDeps = {}) => publicGet(req, env, ABI_KEY, deps);
export const handlePublicSeen = (req: Request, env: Env, deps: EdgeCacheDeps = {}) => publicGet(req, env, ABI_SEEN_KEY, deps);
