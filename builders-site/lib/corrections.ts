/**
 * Ecosystem corrections (spec docs/superpowers/specs/2026-10-21-ecosystem-corrections-design.md).
 *
 *   POST /api/ecosystem/corrections   public HTML form (x-www-form-urlencoded, same origin), Turnstile, rate-limited
 *   GET  /api/admin/corrections       open items, then the last 50 decided (any admin session)
 *   POST /api/admin/corrections       {id, decision: approve | reject, public_note} (role admin only)
 *
 * Checks run in this order: fields (400), rate limits read (429), Turnstile (400); only then are the counters written and
 * the row stored, so a token-less bot costs no KV writes (review #1). A refused form post gets the form back, prefilled
 * from its own body (review #2); nothing the visitor typed goes into a URL. Emails and IP hashes are never returned by
 * any public route.
 */
import { CORRECTION_FIELDS, type CorrectionField } from "../../src/lib/arc-ecosystem-corrections";
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import type { Role } from "./auth";
import type { D1Database, Env } from "./env";
import { json, siteOrigin } from "./http";
import { ERROR_TEXT, type ErrorCode, type FormValues } from "./corrections-codes";
import { renderCorrectionForm } from "./corrections-pages";
export { ERROR_TEXT, type ErrorCode };

/** Form-encoded CJK text is ~9 bytes a character and a Turnstile token up to 2,048: 1,000 characters fit with room (review #3). */
export const CORRECT_MAX_BODY = 16_384;
export const RATE_IP_HOURLY = 5;
export const RATE_EMAIL_DAILY = 3;
export const RETAIN_S = 30 * 24 * 3600;
const NEEDS_SOURCE: ReadonlySet<CorrectionField> = new Set(["status", "contracts", "dates"]);
const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type CorrectionInput = { slug: string; field: CorrectionField; text: string; source_url: string | null; email: string; name: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const httpsUrl = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" && !x.username && !x.password; } catch { return false; } };

export function parseCorrection(form: URLSearchParams, slugs: ReadonlySet<string>): { ok: true; value: CorrectionInput } | { ok: false; code: ErrorCode } {
  const g = (k: string) => (form.get(k) ?? "").trim();
  const slug = g("slug"), field = g("field"), text = g("text"), source = g("source_url"), email = g("email").toLowerCase(), name = g("name");
  if (!slugs.has(slug)) return { ok: false, code: "slug" };
  if (!(CORRECTION_FIELDS as readonly string[]).includes(field)) return { ok: false, code: "field" };
  if (text.length < 10 || text.length > 1000) return { ok: false, code: "text" };
  if (!source && NEEDS_SOURCE.has(field as CorrectionField)) return { ok: false, code: "source_required" };
  if (source && (source.length > 500 || !httpsUrl(source))) return { ok: false, code: "source" };
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, code: "email" };
  if (name.length > 100) return { ok: false, code: "name" };
  return { ok: true, value: { slug, field: field as CorrectionField, text, source_url: source || null, email, name: name || null } };
}

/** The email's domain is the project website's host (without www.) or a subdomain of it: a hint for the reviewer, never proof. */
export function domainMatch(email: string, website?: string): boolean {
  if (!website) return false;
  let host: string;
  try { host = new URL(website).hostname.toLowerCase().replace(/^www\./, ""); } catch { return false; }
  const d = email.split("@")[1]?.toLowerCase() ?? "";
  return d === host || d.endsWith(`.${host}`);
}

/** The form is open only with both Turnstile keys and the data database. */
export const correctionsOpen = (env: Env) => !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET && env.DATA_DB);

async function hmacHex(secret: string, msg: string, bytes = 12): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  return Array.from(mac.slice(0, bytes), (x) => x.toString(16).padStart(2, "0")).join("");
}
const ipOf = (req: Request) => req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

/** KV counters per window. A KV error (daily quota, one write per second per key) never fails the post: reads count as 0
 *  and writes are skipped (review #1). */
async function count(kv: Env["INVITES"], key: string): Promise<number> {
  try { return Number((await kv.get(key)) ?? "0") || 0; } catch { return 0; }
}
async function bump(kv: Env["INVITES"], key: string, n: number, ttl: number): Promise<void> {
  try { await kv.put(key, String(n + 1), { expirationTtl: Math.max(60, ttl) }); } catch { /* best effort */ }
}

async function turnstileOk(secret: string, token: string, ip: string, fetcher: typeof fetch): Promise<boolean> {
  if (!token) return false;
  try {
    const r = await fetcher(TURNSTILE_VERIFY, { method: "POST", body: new URLSearchParams({ secret, response: token, remoteip: ip }), signal: AbortSignal.timeout(8000) });
    return ((await r.json()) as { success?: boolean }).success === true;
  } catch { return false; }
}

const plain = (body: string, status: number, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra } });
const asJson = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const seeOther = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

export async function handleCorrectionPost(req: Request, env: Env, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  if (req.method.toUpperCase() !== "POST") return plain("Only POST is supported.", 405, { allow: "POST" });
  if (!correctionsOpen(env)) return plain("Corrections are not open yet. Email contact@registrai.cc.", 503);
  const origin = siteOrigin(env);
  if (!origin || req.headers.get("origin") !== origin) return plain("Cross-origin request refused.", 403);
  if ((req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") return plain("Send the form.", 415);
  if (Number(req.headers.get("content-length") ?? "0") > CORRECT_MAX_BODY) return plain(ERROR_TEXT.too_large, 413);
  const raw = await req.text();
  if (raw.length > CORRECT_MAX_BODY) return plain(ERROR_TEXT.too_large, 413);
  const form = new URLSearchParams(raw);
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
  const slugs = new Set(ECOSYSTEM.entities.map((e) => e.slug));
  const entity = ECOSYSTEM.bySlug.get((form.get("slug") ?? "").trim());
  const values: FormValues = { field: form.get("field") ?? "", text: form.get("text") ?? "", source_url: form.get("source_url") ?? "", email: form.get("email") ?? "", name: form.get("name") ?? "" };
  // a form post gets its form back, prefilled; a JSON caller (or an unknown slug: no form to go back to) gets the status
  const fail = (code: ErrorCode, status: number) => (wantsJson || !entity
    ? asJson({ error: code, message: ERROR_TEXT[code] }, status)
    : new Response(renderCorrectionForm(entity, { siteKey: env.TURNSTILE_SITE_KEY!, sent: false, error: code, values }), { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" } }));
  const p = parseCorrection(form, slugs);
  if (!p.ok) return fail(p.code, 400);
  const v = p.value, ip = ipOf(req), secret = env.NONCE_SECRET ?? "registrai-corrections";
  const hour = Math.floor(now / 3600e3), day = Math.floor(now / 86400e3);
  const ipKey = `correct-rl:${await hmacHex(secret, `correct:${ip}`)}:${hour}`, emailKey = `correct-em:${await hmacHex(secret, `correct-email:${v.email}`)}:${day}`;
  const [ipN, emailN] = await Promise.all([count(env.INVITES, ipKey), count(env.INVITES, emailKey)]);
  if (ipN >= RATE_IP_HOURLY || emailN >= RATE_EMAIL_DAILY) return fail("rate", 429);
  if (!(await turnstileOk(env.TURNSTILE_SECRET!, form.get("cf-turnstile-response") ?? "", ip, fetcher))) return fail("antibot", 400);
  await Promise.all([bump(env.INVITES, ipKey, ipN, 3600), bump(env.INVITES, emailKey, emailN, 86400)]);
  const ipHash = ipKey.split(":")[1];
  const row = await env.DATA_DB!.prepare(`INSERT INTO corrections (slug, field, text, source_url, email, name, domain_match, ip_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(v.slug, v.field, v.text, v.source_url, v.email, v.name, domainMatch(v.email, entity?.website) ? 1 : 0, ipHash, Math.floor(now / 1000)).first<{ id: number }>();
  return wantsJson ? asJson({ id: row?.id ?? null }, 201) : seeOther(`/ecosystem/${v.slug}/correct/?sent=1`);
}

export type AdminCorrection = { id: number; slug: string; name: string; field: string; text: string; source_url: string | null; email: string | null; person: string | null;
  domain_match: boolean; status: "open" | "approved" | "rejected" | "applied"; public_note: string | null; created_at: number; decided_at: number | null; decided_by: string | null; applied_at: number | null };
const COLS = "id, slug, field, text, source_url, email, name, domain_match, status, public_note, created_at, decided_at, decided_by, applied_at";
const toAdmin = (r: Record<string, unknown>): AdminCorrection => ({
  id: Number(r.id), slug: String(r.slug), name: ECOSYSTEM.bySlug.get(String(r.slug))?.name ?? String(r.slug), field: String(r.field), text: String(r.text),
  source_url: (r.source_url as string | null) ?? null, email: (r.email as string | null) ?? null, person: (r.name as string | null) ?? null, domain_match: Number(r.domain_match) === 1,
  status: r.status as AdminCorrection["status"], public_note: (r.public_note as string | null) ?? null, created_at: Number(r.created_at),
  decided_at: r.decided_at == null ? null : Number(r.decided_at), decided_by: (r.decided_by as string | null) ?? null, applied_at: r.applied_at == null ? null : Number(r.applied_at),
});

export async function handleAdminCorrections(req: Request, env: Env, who: { address: string; role: Role }, now = Date.now()): Promise<Response> {
  const db = env.DATA_DB;
  if (!db) return json({ error: "DATA_DB is not bound" }, 503);
  const m = req.method.toUpperCase();
  if (m === "GET") {
    const open = (await db.prepare(`SELECT ${COLS} FROM corrections WHERE status = 'open' ORDER BY created_at, id`).all()).results.map(toAdmin);
    const decided = (await db.prepare(`SELECT ${COLS} FROM corrections WHERE status != 'open' ORDER BY decided_at DESC, id DESC LIMIT 50`).all()).results.map(toAdmin);
    return json({ open, decided });
  }
  if (m !== "POST") return json({ error: "Only GET and POST are supported." }, 405);
  if (who.role !== "admin") return json({ error: "Only the admin role can decide corrections." }, 403);
  const b = (await req.json().catch(() => null)) as { id?: unknown; decision?: unknown; public_note?: unknown } | null;
  const id = Number(b?.id), decision = b?.decision, note = typeof b?.public_note === "string" ? b.public_note.trim() : "";
  if (!Number.isInteger(id) || id < 1 || (decision !== "approve" && decision !== "reject")) return json({ error: "Send {id, decision: approve | reject, public_note}." }, 400);
  if (decision === "approve" && (note.length < 5 || note.length > 200)) return json({ error: "The public note must be 5-200 characters." }, 400);
  const res = await db.prepare(`UPDATE corrections SET status = ?, public_note = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'open'`)
    .bind(decision === "approve" ? "approved" : "rejected", decision === "approve" ? note : null, Math.floor(now / 1000), who.address, id).run();
  const row = await db.prepare(`SELECT ${COLS} FROM corrections WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!row) return json({ error: "No such correction." }, 404);
  if (!res.meta.changes) return json({ error: "This correction was already decided.", correction: toAdmin(row) }, 409);
  return json({ correction: toAdmin(row) });
}

/** Clears email, name and IP hash 30 days after the decision (spec: privacy). Open items are never cleared. */
export async function purgeCorrections(db: D1Database, now = Date.now()): Promise<number> {
  const r = await db.prepare(`UPDATE corrections SET email = NULL, name = NULL, ip_hash = '' WHERE decided_at IS NOT NULL AND decided_at < ? AND (email IS NOT NULL OR name IS NOT NULL OR ip_hash != '')`)
    .bind(Math.floor(now / 1000) - RETAIN_S).run();
  return r.meta.changes ?? 0;
}
