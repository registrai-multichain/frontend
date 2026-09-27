/**
 * Public project suggestions (builder.registrai.cc/suggest): anyone may point us
 * at a project for the invite list. A suggestion carries no authority: it lands
 * in /admin, where the owner decides whether to invite (and later nominate) it.
 *
 * Required: the project's name, its website, and social proof: its X account
 * or, failing that, another public https link (Farcaster, Telegram, Discord…).
 * Optional: its GitHub repo (only a GitHub project can get wonder markets: the
 * milestone feed counts its releases), why it belongs, and the suggester's own
 * X handle. The project's key (`source`) is its GitHub repo when given, else
 * its website's domain, so repeat suggestions of one project collapse.
 */
import { normalizeSource } from "./verified-builders";

export const SUGGEST_LIMITS = { name: 80, website: 200, github: 200, x: 64, social: 200, why: 280, by: 64 } as const;

export interface Suggestion {
  /** Canonical source: `github:owner/repo` when a repo was given, else `domain:host`. */
  source: string;
  name: string;
  /** https URL of the project's site. */
  website: string;
  /** `github:owner/repo`. */
  github?: string;
  /** "@handle" */
  x?: string;
  /** Another public https link (social proof when there is no X account). */
  social?: string;
  why?: string;
  /** The suggester's X handle, "@handle". */
  by?: string;
}

/** A stored suggestion as /admin sees it (GET /api/admin/suggestions). */
export interface AdminSuggestion extends Omit<Suggestion, "by"> {
  /** Suggesters' own X handles, first come. */
  by: string[];
  /** Distinct visitors who suggested it. */
  count: number;
  firstAt: string;
  lastAt: string;
}

export type SuggestionField = keyof typeof SUGGEST_LIMITS;
export type SuggestionResult = { ok: true; value: Suggestion } | { ok: false; field?: SuggestionField; error: string };

const HANDLE_RE = /^@?([A-Za-z0-9_]{1,15})$/;
const X_URL_RE = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i;

/** "@handle" from a handle or an x.com / twitter.com profile URL, else null. */
export function xHandle(raw: string): string | null {
  const s = raw.trim();
  const m = HANDLE_RE.exec(s) ?? X_URL_RE.exec(s);
  return m ? `@${m[1]}` : null;
}

/** The website as a clean https URL (scheme added when missing), else null. */
function website(raw: string): { url: string; source: string } | null {
  const s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme && !/^https?$/i.test(scheme[1])) return null;
  let u: URL;
  try {
    u = new URL(scheme ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const source = normalizeSource(`domain:${host}`);
  if (!source || host === "localhost" || host === "127.0.0.1") return null;
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "");
  return { url: `https://${host}${path}`, source };
}

function httpsLink(raw: string): string | null {
  const s = raw.trim();
  if (!/^https:\/\//i.test(s) || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Validate a suggestion body (a parsed JSON object). */
export function validateSuggestion(body: unknown): SuggestionResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "expected a JSON object" };
  const b = body as Record<string, unknown>;
  const str: Partial<Record<SuggestionField, string>> = {};
  for (const f of Object.keys(SUGGEST_LIMITS) as SuggestionField[]) {
    const v = b[f];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return { ok: false, field: f, error: `${f} must be text` };
    const t = v.trim();
    if (t.length > SUGGEST_LIMITS[f]) return { ok: false, field: f, error: `${f} is longer than ${SUGGEST_LIMITS[f]} characters` };
    if (t) str[f] = t;
  }

  if (!str.name) return { ok: false, field: "name", error: "Give the project's name." };
  const site = str.website ? website(str.website) : null;
  if (!site) return { ok: false, field: "website", error: "Give the project's website (e.g. https://example.com)." };

  let github: string | undefined;
  if (str.github) {
    const g = normalizeSource(str.github);
    if (!g?.startsWith("github:")) return { ok: false, field: "github", error: "That is not a GitHub repo (owner/repo or its URL)." };
    github = g;
  }
  let x: string | undefined;
  if (str.x) {
    const h = xHandle(str.x);
    if (!h) return { ok: false, field: "x", error: "That is not an X account (@handle or its x.com link)." };
    x = h;
  }
  let social: string | undefined;
  if (str.social) {
    const l = httpsLink(str.social);
    if (!l) return { ok: false, field: "social", error: "The other link must be an https:// URL." };
    social = l;
  }
  if (!x && !social) {
    return { ok: false, field: "x", error: "Add the project's X account (or another public social link) as social proof." };
  }
  let by: string | undefined;
  if (str.by) {
    const h = xHandle(str.by);
    if (!h) return { ok: false, field: "by", error: "Your X handle looks wrong (@handle)." };
    by = h;
  }

  const value: Suggestion = { source: github ?? site.source, name: str.name, website: site.url };
  if (github) value.github = github;
  if (x) value.x = x;
  if (social) value.social = social;
  if (str.why) value.why = str.why;
  if (by) value.by = by;
  return { ok: true, value };
}

/** What /admin's "Invite" sends to POST /api/admin/invites for a suggestion: the evidence goes in the private note. */
export function suggestionInvite(s: {
  source: string;
  name: string;
  website: string;
  github?: string;
  x?: string;
  social?: string;
  why?: string;
  by: readonly string[];
  count: number;
}): { source: string; name: string; x?: string; note: string } {
  const who = s.by.length ? ` (${s.by.join(", ")})` : "";
  const parts = [`Suggested by ${s.count}${who}.`, `Site: ${s.website}`];
  if (s.social) parts.push(`Social: ${s.social}`);
  if (s.why) parts.push(`Why: ${s.why}`);
  let note = parts.join(" ");
  if (note.length > 500) note = `${note.slice(0, 499)}…`;
  const out: { source: string; name: string; x?: string; note: string } = { source: s.source, name: s.name, note };
  if (s.x) out.x = s.x;
  return out;
}
