/** The admin view of an ecosystem correction (mirror of builders-site/lib/corrections.ts AdminCorrection). */
export type AdminCorrection = { id: number; slug: string; name: string; field: string; text: string; source_url: string | null; email: string | null; person: string | null;
  domain_match: boolean; status: "open" | "approved" | "rejected" | "applied"; public_note: string | null; created_at: number; decided_at: number | null; decided_by: string | null; applied_at: number | null };

/** The approve box starts from the first 200 characters of the text, trimmed to a whole word. */
export function defaultNote(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= 200) return t;
  const cut = t.slice(0, 200);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 5));
}
