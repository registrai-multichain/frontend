/**
 * Ecosystem corrections (spec docs/superpowers/specs/2026-10-21-ecosystem-corrections-design.md).
 *
 *   POST /api/ecosystem/corrections   public HTML form (x-www-form-urlencoded, same origin), Turnstile, rate-limited
 *
 * Checks run in this order: fields (400 / ?error=), rate limits (429 / ?error=rate), Turnstile (?error=antibot). Error
 * redirects carry a code, never user input. Emails and IP hashes are never returned by any public route.
 */
import { CORRECTION_FIELDS, type CorrectionField } from "../../src/lib/arc-ecosystem-corrections";
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import type { Env } from "./env";
import { siteOrigin } from "./http";

export const CORRECT_MAX_BODY = 4096;
export const RATE_IP_HOURLY = 5;
export const RATE_EMAIL_DAILY = 3;
export const RETAIN_S = 30 * 24 * 3600;
const NEEDS_SOURCE: ReadonlySet<CorrectionField> = new Set(["status", "contracts", "dates"]);
const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type ErrorCode = "slug" | "field" | "text" | "source_required" | "source" | "email" | "name" | "too_large" | "rate" | "antibot";
export const ERROR_TEXT: Record<ErrorCode, string> = {
  slug: "Unknown project.", field: "Choose what is wrong.", text: "The correction must be 10 to 1,000 characters.",
  source_required: "Add a source link for status, contract and date corrections.", source: "The source must be an https link.",
  email: "Enter a valid email address.", name: "Name and role can be at most 100 characters.", too_large: "The correction is too long.",
  rate: "Too many corrections from you today. Try again later.", antibot: "Anti-bot check failed, try again.",
};
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

/** One counter per window in KV; false once the window already holds `max`. */
async function underLimit(kv: Env["INVITES"], key: string, max: number, ttl: number): Promise<boolean> {
  const n = Number((await kv.get(key)) ?? "0") || 0;
  if (n >= max) return false;
  await kv.put(key, String(n + 1), { expirationTtl: Math.max(60, ttl) });
  return true;
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
  const raw = await req.text();
  if (raw.length > CORRECT_MAX_BODY) return plain(ERROR_TEXT.too_large, 400);
  const form = new URLSearchParams(raw);
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
  const slugs = new Set(ECOSYSTEM.entities.map((e) => e.slug));
  const slug = (form.get("slug") ?? "").trim();
  // a form post goes back to its form with a code; a JSON caller (or an unknown slug: no form to go back to) gets the status
  const fail = (code: ErrorCode, status: number) => (wantsJson || !slugs.has(slug) ? asJson({ error: code, message: ERROR_TEXT[code] }, status) : seeOther(`/ecosystem/${slug}/correct/?error=${code}`));
  const p = parseCorrection(form, slugs);
  if (!p.ok) return fail(p.code, 400);
  const v = p.value, ip = ipOf(req), secret = env.NONCE_SECRET ?? "registrai-corrections";
  const ipHash = await hmacHex(secret, `correct:${ip}`);
  const emailHash = await hmacHex(secret, `correct-email:${v.email}`);
  const hour = Math.floor(now / 3600e3), day = Math.floor(now / 86400e3);
  if (!(await underLimit(env.INVITES, `correct-rl:${ipHash}:${hour}`, RATE_IP_HOURLY, 3600))) return fail("rate", 429);
  if (!(await underLimit(env.INVITES, `correct-em:${emailHash}:${day}`, RATE_EMAIL_DAILY, 86400))) return fail("rate", 429);
  if (!(await turnstileOk(env.TURNSTILE_SECRET!, form.get("cf-turnstile-response") ?? "", ip, fetcher))) return fail("antibot", 400);
  const website = ECOSYSTEM.bySlug.get(v.slug)?.website;
  const row = await env.DATA_DB!.prepare(`INSERT INTO corrections (slug, field, text, source_url, email, name, domain_match, ip_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(v.slug, v.field, v.text, v.source_url, v.email, v.name, domainMatch(v.email, website) ? 1 : 0, ipHash, Math.floor(now / 1000)).first<{ id: number }>();
  return wantsJson ? asJson({ id: row?.id ?? null }, 201) : seeOther(`/ecosystem/${v.slug}/correct/?sent=1`);
}
