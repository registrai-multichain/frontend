/**
 * The builders-site admin: what the /admin page (browser) and the
 * builders-site Pages Functions (builders-site/functions, server) must agree
 * on — the sign-in message, the invite record and its validation, the public
 * projection, the claim link.
 *
 * Pure. RELATIVE IMPORTS ONLY: wrangler bundles this file into the Pages
 * Functions with its own esbuild, which does not know the "@/" alias.
 */
import { isAddress } from "viem";
import { normalizeSource, sourceLabel } from "./verified-builders";

// ───────────────────────────── sign-in ─────────────────────────────

export const ADMIN_LOGIN_TITLE = "Registrai builders admin sign-in";
/** A sign-in message is accepted for this long after its `issued` time. */
export const LOGIN_MAX_AGE_MS = 5 * 60_000;
/** Clock skew tolerated for an `issued` time in the future. */
export const LOGIN_MAX_SKEW_MS = 60_000;
/** A nonce's lifetime (and its used-nonce KV record's TTL), seconds. */
export const NONCE_TTL_S = 5 * 60;
export const SESSION_TTL_S = 12 * 60 * 60;
export const SESSION_COOKIE = "__Host-rb_admin";
/** /api/auth/me says this, so the page can tell the API from a static 404. */
export const ADMIN_SERVICE = "registrai-builders-admin";

export interface AdminLogin {
  origin: string;
  nonce: string;
  /** ISO 8601 UTC, e.g. 2026-09-24T12:00:00.000Z */
  issued: string;
}

/** The builders site's stateless nonce (base64url; builders-site/lib/auth.ts). */
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** The exact bytes an admin signs (EIP-191 personal_sign). */
export function adminLoginMessage(p: AdminLogin): string {
  return [ADMIN_LOGIN_TITLE, `origin: ${p.origin}`, `nonce: ${p.nonce}`, `issued: ${p.issued}`].join("\n");
}

/** A sign-in message back into its fields; null unless it is exactly the canonical form. */
export function parseAdminLoginMessage(message: string): AdminLogin | null {
  const lines = message.split("\n");
  if (lines.length !== 4 || lines[0] !== ADMIN_LOGIN_TITLE) return null;
  const origin = /^origin: (.+)$/.exec(lines[1])?.[1];
  const nonce = /^nonce: (.+)$/.exec(lines[2])?.[1];
  const issued = /^issued: (.+)$/.exec(lines[3])?.[1];
  if (!origin || !ORIGIN_RE.test(origin)) return null;
  if (!nonce || !NONCE_RE.test(nonce)) return null;
  if (!issued || !ISO_RE.test(issued) || !Number.isFinite(Date.parse(issued))) return null;
  const parsed = { origin, nonce, issued };
  return adminLoginMessage(parsed) === message ? parsed : null;
}

/** `issued` is at most LOGIN_MAX_AGE_MS old and not more than the skew in the future. */
export function issuedFresh(issued: string, nowMs: number): boolean {
  const t = Date.parse(issued);
  if (!Number.isFinite(t)) return false;
  return t <= nowMs + LOGIN_MAX_SKEW_MS && nowMs - t <= LOGIN_MAX_AGE_MS;
}

/** ADMIN_ADDRESSES ("0xabc…, 0xdef…") -> the lowercase addresses; anything else is dropped. */
export function parseAdminAllowlist(raw: string | null | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => isAddress(s, { strict: false })),
  );
}

// ───────────────────────────── invites ─────────────────────────────

/** KV `invite:<normalized source>`. */
export interface InviteRecord {
  source: string;
  name?: string;
  /** "@handle" */
  x?: string;
  /** Private; never leaves the admin API. */
  note?: string;
  /** The personal claim link's secret. */
  code: string;
  /** ISO time. */
  createdAt: string;
  /** Lowercase admin address. */
  createdBy: string;
  opens: number;
  firstOpenedAt?: string;
  lastOpenedAt?: string;
}

/** What GET /api/invites shows the world. */
export interface PublicInvite {
  source: string;
  name?: string;
  x?: string;
  createdAt: string;
}

export const INVITE_LIMITS = { name: 80, x: 32, note: 500 } as const;
const X_RE = /^@?([A-Za-z0-9_]{1,15})$/;
export const INVITE_CODE_RE = /^[0-9a-f]{24}$/;

export const inviteKey = (source: string) => `invite:${source}`;

/** The public projection: never the note, the code or the tracking. */
export function publicInvite(r: InviteRecord): PublicInvite {
  const out: PublicInvite = { source: r.source, createdAt: r.createdAt };
  if (r.name) out.name = r.name;
  if (r.x) out.x = r.x;
  return out;
}

/** Edits: a string sets the field, null (or "") clears it, absent leaves it. */
export interface InviteFields {
  name?: string | null;
  x?: string | null;
  note?: string | null;
}

export type InviteInput =
  | { ok: true; source: string; fields: InviteFields }
  | { ok: false; error: string };

function field(v: unknown, key: keyof typeof INVITE_LIMITS): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${key} must be a string` };
  const s = v.trim();
  if (!s) return { ok: true, value: null };
  if (s.length > INVITE_LIMITS[key]) return { ok: false, error: `${key} is longer than ${INVITE_LIMITS[key]} characters` };
  if (key === "x") {
    const m = X_RE.exec(s);
    if (!m) return { ok: false, error: "x must be an X handle (letters, digits, _; at most 15)" };
    return { ok: true, value: `@${m[1]}` };
  }
  return { ok: true, value: s };
}

/** A POST / PATCH body: the normalised source plus validated fields. */
export function validateInviteInput(body: unknown): InviteInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "expected a JSON object" };
  const b = body as Record<string, unknown>;
  if (typeof b.source !== "string") return { ok: false, error: "source is required" };
  const source = normalizeSource(b.source);
  if (!source) return { ok: false, error: "source must be a GitHub repo (owner/repo or URL) or a domain" };
  const fields: InviteFields = {};
  for (const key of ["name", "x", "note"] as const) {
    const r = field(b[key], key);
    if (!r.ok) return r;
    if (r.value !== undefined) fields[key] = r.value;
  }
  return { ok: true, source, fields };
}

/** Apply edits to a record (a new object). */
export function applyInviteFields(r: InviteRecord, f: InviteFields): InviteRecord {
  const out: InviteRecord = { ...r };
  for (const key of ["name", "x", "note"] as const) {
    if (!(key in f)) continue;
    const v = f[key];
    if (v) out[key] = v;
    else delete out[key];
  }
  return out;
}

/** A new invite's record. */
export function newInvite(source: string, f: InviteFields, o: { code: string; createdAt: string; createdBy: string }): InviteRecord {
  return applyInviteFields({ source, code: o.code, createdAt: o.createdAt, createdBy: o.createdBy.toLowerCase(), opens: 0 }, f);
}

/** An open of the claim link. */
export function recordOpen(r: InviteRecord, at: string): InviteRecord {
  return { ...r, opens: (r.opens ?? 0) + 1, firstOpenedAt: r.firstOpenedAt ?? at, lastOpenedAt: at };
}

/** The personal claim link: /verify with the source prefilled and the tracking code. */
export function claimLink(origin: string, source: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/verify/?source=${encodeURIComponent(source)}&invite=${encodeURIComponent(code)}`;
}

/** The copy-ready X DM. */
export function inviteDm(inv: { source: string; name?: string }, link: string): string {
  return `Hey${inv.name ? ` ${inv.name}` : ""}, we'd like to list ${sourceLabel(inv.source)} as a Registrai verified builder on Arc. Claim it here (takes 2 minutes, signing is free): ${link}`;
}

/** Length-independent-time string comparison (secrets: invite codes). */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
