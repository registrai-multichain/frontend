/** The public corrections log of the Arc ecosystem directory (spec docs/superpowers/specs/2026-10-21-ecosystem-corrections-design.md). */
export const CORRECTION_FIELDS = ["summary", "status", "links", "category", "contracts", "dates", "sources", "removal", "other"] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];
export type CorrectionEntry = { id: number; date: string; slug: string; field: CorrectionField; change: string; source?: string; from: "project" | "reader" | "review" };
export const FIELD_LABEL: Record<CorrectionField, string> = {
  summary: "Summary", status: "Status", links: "Website or links", category: "Category", contracts: "Contracts",
  dates: "Dates", sources: "Sources", removal: "Remove this listing", other: "Other",
};

const KEYS = new Set(["id", "date", "slug", "field", "change", "source", "from"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isField = (f: unknown): f is CorrectionField => typeof f === "string" && (CORRECTION_FIELDS as readonly string[]).includes(f);
const httpsUrl = (u: unknown) => { if (typeof u !== "string") return false; try { const x = new URL(u); return x.protocol === "https:" && !x.username && !x.password; } catch { return false; } };

export function validateCorrections(list: unknown, slugs: ReadonlySet<string>): { ok: true; corrections: CorrectionEntry[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(list)) return { ok: false, errors: ["expected an array of corrections"] };
  const errors: string[] = [], ids = new Set<number>();
  const removed = new Set(list.filter((c) => c && typeof c === "object" && (c as CorrectionEntry).field === "removal").map((c) => (c as CorrectionEntry).slug));
  list.forEach((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const err = (m: string) => errors.push(`#${i} ${typeof c.id === "number" ? c.id : "?"}: ${m}`);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return err("not an object");
    for (const k of Object.keys(c)) if (!KEYS.has(k)) err(`unknown field ${k}`);
    if (typeof c.id !== "number" || !Number.isInteger(c.id) || c.id < 1) err("id must be a positive integer");
    else if (ids.has(c.id)) err("duplicate id"); else ids.add(c.id);
    if (typeof c.date !== "string" || !DAY.test(c.date)) err("date must be YYYY-MM-DD");
    if (!isField(c.field)) err("field must be one of " + CORRECTION_FIELDS.join(", "));
    if (typeof c.change !== "string" || c.change.trim().length < 5 || c.change.length > 200) err("change must be 5-200 characters");
    if (c.source !== undefined && !httpsUrl(c.source)) err("source must be an https URL");
    if (c.from !== "project" && c.from !== "reader" && c.from !== "review") err("from must be project, reader or review");
    if (typeof c.slug !== "string" || !(slugs.has(c.slug) || removed.has(c.slug))) err("slug must be a published entity or a removed one with a removal entry");
  });
  return errors.length ? { ok: false, errors } : { ok: true, corrections: list as CorrectionEntry[] };
}

/** Newest first (date, then id); per slug; and the removal entry of each removed slug. */
export function indexCorrections(l: CorrectionEntry[]) {
  const all = [...l].sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
  const bySlug = new Map<string, CorrectionEntry[]>(), removed = new Map<string, CorrectionEntry>();
  for (const c of all) {
    bySlug.set(c.slug, [...(bySlug.get(c.slug) ?? []), c]);
    if (c.field === "removal" && !removed.has(c.slug)) removed.set(c.slug, c);
  }
  return { all, bySlug, removed };
}
