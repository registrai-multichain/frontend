/** Pure helpers of scripts/ecosystem-corrections.ts (spec docs/superpowers/specs/2026-10-21-ecosystem-corrections-design.md §4). */
export type ApprovedRow = { id: number; slug: string; field: string; text: string; source_url: string | null; domain_match: number; public_note: string | null; decided_at: number };

/** Approved, not yet applied, oldest decision first. The IP hash and the email are never read. */
export const listSql = () => "SELECT id, slug, field, text, source_url, domain_match, public_note, decided_at FROM corrections WHERE status = 'approved' ORDER BY decided_at, id";

export function markAppliedSql(ids: number[], nowS: number): string {
  if (!ids.length || ids.some((i) => !Number.isInteger(i) || i < 1)) throw new Error("ids must be positive integers");
  return `UPDATE corrections SET status = 'applied', applied_at = ${Math.floor(nowS)} WHERE status = 'approved' AND id IN (${ids.join(", ")})`;
}

export const nextLogId = (log: { id: number }[]) => log.reduce((m, c) => Math.max(m, c.id), 0) + 1;

export const formatRow = (r: ApprovedRow) =>
  `#${r.id} ${r.slug} · ${r.field} · from: ${r.domain_match === 1 ? "project" : "reader"}\n  text: ${r.text}\n  source: ${r.source_url ?? "–"}\n  public note: ${r.public_note ?? "–"}`;
