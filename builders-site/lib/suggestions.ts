/**
 * Public project suggestions (spec: src/lib/suggestions.ts).
 *
 *   POST   /api/suggestions                  public (same-origin JSON only), rate-limited per visitor
 *   GET    /api/admin/suggestions            every open suggestion, most suggested first
 *   DELETE /api/admin/suggestions?source=    dismiss one
 *
 * One KV record per project (`suggest:<source>`), kept SUGGEST_TTL_S after its
 * latest suggestion. The first suggestion's details stand; later ones only fill
 * fields still empty, so nobody can overwrite a good suggestion with junk. The
 * count is of distinct visitors, each stored as a keyed hash of its IP (never
 * the IP). A suggestion carries no authority: /admin decides whether to invite.
 */
import { inviteKey } from "../../src/lib/builders-admin";
import { validateSuggestion, type AdminSuggestion } from "../../src/lib/suggestions";
import { normalizeSource } from "../../src/lib/verified-builders";
import type { Env, KV } from "./env";
import { csrfFailure, errorJson, json, siteOrigin } from "./http";

export const SUGGEST_PREFIX = "suggest:";
const RATE_PREFIX = "suggest-rl:";
/** A suggestion is dropped 90 days after it was last made. */
export const SUGGEST_TTL_S = 90 * 24 * 3600;
export const SUGGEST_MAX_BODY = 2048;
/** Suggestions one visitor may send per hour. */
export const SUGGEST_RATE_LIMIT = 5;
const RATE_WINDOW_S = 3600;
const MAX_VOTERS = 200;
const MAX_BY = 10;

export interface SuggestionRecord extends AdminSuggestion {
  /** Keyed hashes of the visitors (private: never leaves this module). */
  voters: string[];
}

export type PublicSuggestion = AdminSuggestion;

const key = (source: string) => `${SUGGEST_PREFIX}${source}`;

async function visitorId(req: Request, env: Env): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const secret = env.NONCE_SECRET ?? "registrai-suggestions";
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`suggest:${ip}`)));
  return Array.from(mac.slice(0, 12), (x) => x.toString(16).padStart(2, "0")).join("");
}

function parseRecord(text: string | null): SuggestionRecord | null {
  if (!text) return null;
  try {
    const r = JSON.parse(text) as SuggestionRecord;
    return typeof r?.source === "string" && typeof r.name === "string" && Array.isArray(r.voters) ? r : null;
  } catch {
    return null;
  }
}

function publicView(r: SuggestionRecord): PublicSuggestion {
  const out: Partial<SuggestionRecord> = { ...r };
  delete out.voters;
  return out as PublicSuggestion;
}

/** POST /api/suggestions */
export async function handleSuggest(req: Request, env: Env, deps: { now?: number } = {}): Promise<Response> {
  const csrf = csrfFailure(req, siteOrigin(env));
  if (csrf) return errorJson(403, csrf);
  if (Number(req.headers.get("content-length") ?? "0") > SUGGEST_MAX_BODY) return errorJson(413, "request too large");
  const text = await req.text();
  if (text.length > SUGGEST_MAX_BODY) return errorJson(413, "request too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return errorJson(400, "expected JSON");
  }
  const v = validateSuggestion(body);
  if (!v.ok) return errorJson(400, v.error, v.field ? { field: v.field } : {});
  const s = v.value;
  const nowMs = deps.now ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (await env.INVITES.get(inviteKey(s.source))) return json({ ok: true, source: s.source, invited: true });

  const voter = await visitorId(req, env);
  const rateKey = `${RATE_PREFIX}${voter}`;
  const rate = safeRate(await env.INVITES.get(rateKey), nowMs);
  if (rate.n >= SUGGEST_RATE_LIMIT) return errorJson(429, "Too many suggestions from here: try again in an hour.");

  const prev = parseRecord(await env.INVITES.get(key(s.source)));
  const rec: SuggestionRecord = prev ?? { source: s.source, name: s.name, website: s.website, by: [], count: 0, firstAt: nowIso, lastAt: nowIso, voters: [] };
  // First details stand; a later suggestion only fills what is missing.
  for (const f of ["github", "x", "social", "why"] as const) if (!rec[f] && s[f]) rec[f] = s[f];
  if (s.by && !rec.by.includes(s.by) && rec.by.length < MAX_BY) rec.by.push(s.by);
  if (!rec.voters.includes(voter)) {
    rec.count += 1;
    if (rec.voters.length < MAX_VOTERS) rec.voters.push(voter);
  }
  rec.lastAt = nowIso;

  await env.INVITES.put(key(s.source), JSON.stringify(rec), {
    expirationTtl: SUGGEST_TTL_S,
    metadata: { source: rec.source, count: rec.count, lastAt: rec.lastAt },
  });
  await env.INVITES.put(rateKey, JSON.stringify({ n: rate.n + 1, since: rate.since }), {
    expirationTtl: Math.max(60, Math.ceil((rate.since + RATE_WINDOW_S * 1000 - nowMs) / 1000)),
  });
  return json({ ok: true, source: rec.source, count: rec.count });
}

function safeRate(text: string | null, nowMs: number): { n: number; since: number } {
  try {
    const r = text ? (JSON.parse(text) as { n?: unknown; since?: unknown }) : null;
    if (r && typeof r.n === "number" && typeof r.since === "number" && nowMs - r.since < RATE_WINDOW_S * 1000) return { n: r.n, since: r.since };
  } catch {
    // a fresh window
  }
  return { n: 0, since: nowMs };
}

/** Every open suggestion, most suggested first, then the most recent. */
export async function listSuggestions(kv: KV): Promise<PublicSuggestion[]> {
  const out: PublicSuggestion[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: SUGGEST_PREFIX, cursor });
    for (const k of page.keys) {
      const r = parseRecord(await kv.get(k.name));
      if (r) out.push(publicView(r));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

/** GET / DELETE /api/admin/suggestions (the middleware has checked the session and CSRF). */
export async function handleAdminSuggestions(req: Request, env: Env): Promise<Response> {
  const method = req.method.toUpperCase();
  if (method === "GET") return json({ suggestions: await listSuggestions(env.INVITES) });
  if (method === "DELETE") {
    const source = normalizeSource(new URL(req.url).searchParams.get("source") ?? "");
    if (!source) return errorJson(400, "source missing");
    await env.INVITES.delete(key(source));
    return json({ deleted: source });
  }
  return errorJson(405, "method not allowed");
}
