/**
 * Nomination drafts: the investigation session's (arc-80) prepared anchoring for a
 * project, so the owner only reviews and signs in /admin → Nominate on chain.
 * Files: docs/superpowers/investigations/drafts/<slug>.json, loaded into the builders
 * KV (`draft:<source>`) by builders-site/scripts/load-drafts.ts. Private: a draft's
 * profile holds red flags and notes.
 *
 *   GET    /api/admin/drafts                (admin or onboarder session)
 *   POST   /api/admin/drafts                (admin) one draft, validated here
 *   DELETE /api/admin/drafts/<source>       (admin)
 */
import { validateProfile, type ProfileInput } from "./projects";
import { xHandle } from "./suggestions";
import { normalizeSource } from "./verified-builders";

export type DraftRecommendation = "nominate" | "hold";

export interface NominationDraft {
  source: string;
  invite: { name: string; x?: string };
  recommendation: DraftRecommendation;
  /** One or two lines for the owner. */
  summary: string;
  /** Repo-relative path of the investigation write-up. */
  investigation: string;
  investigatedAt: string;
  investigatedBy: string;
  profile: ProfileInput;
}

export const DRAFT_LIMITS = { summary: 300, name: 80, path: 200, meta: 60 } as const;
const INVESTIGATION_DIR = "docs/superpowers/investigations/";

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
}

export function validateDraft(body: unknown): { ok: true; value: NominationDraft } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "expected a JSON object" };
  const b = body as Record<string, unknown>;
  const source = typeof b.source === "string" ? normalizeSource(b.source) : null;
  if (!source) return { ok: false, error: "source must be github:owner/repo or domain:host" };
  if (b.recommendation !== "nominate" && b.recommendation !== "hold") return { ok: false, error: "recommendation must be nominate or hold" };
  const summary = str(b.summary, DRAFT_LIMITS.summary);
  if (!summary) return { ok: false, error: `summary is required (at most ${DRAFT_LIMITS.summary} characters)` };
  const investigation = str(b.investigation, DRAFT_LIMITS.path);
  if (!investigation || !investigation.startsWith(INVESTIGATION_DIR) || investigation.includes("..") || !investigation.endsWith(".md")) {
    return { ok: false, error: `investigation must be a .md path under ${INVESTIGATION_DIR}` };
  }
  const investigatedAt = str(b.investigatedAt, DRAFT_LIMITS.meta);
  const investigatedBy = str(b.investigatedBy, DRAFT_LIMITS.meta);
  if (!investigatedAt || !investigatedBy) return { ok: false, error: "investigatedAt and investigatedBy are required" };
  const inv = (b.invite ?? {}) as Record<string, unknown>;
  const name = str(inv.name, DRAFT_LIMITS.name);
  if (!name) return { ok: false, error: "invite.name is required" };
  const invite: NominationDraft["invite"] = { name };
  if (inv.x !== undefined && inv.x !== null && inv.x !== "") {
    const x = typeof inv.x === "string" ? xHandle(inv.x) : null;
    if (!x) return { ok: false, error: "invite.x must be an X account" };
    invite.x = x;
  }
  const p = validateProfile(b.profile, source);
  if (!p.ok) return { ok: false, error: `profile: ${p.error}` };
  return { ok: true, value: { source, invite, recommendation: b.recommendation, summary, investigation, investigatedAt, investigatedBy, profile: p.value } };
}
