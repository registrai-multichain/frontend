/**
 * Registrai's own review of directory entries (spec 2026-10-23-ai-search-gaps-design.md §2): each reviewed change is
 * applied to the entity and logged as a public correction from "review". A launch date or a new status needs evidence;
 * a date must equal its evidence's date. Pure: data in, data out.
 */
import type { ArcEntity, CategoryId, EntityStatus, Source } from "./arc-ecosystem";
import type { CorrectionEntry } from "./arc-ecosystem-corrections";

export type ReviewItem = { slug: string; field: "dates" | "status" | "category";
  set: { first_live?: string | null; status?: EntityStatus; category?: CategoryId; add_tags?: CategoryId[] };
  evidence?: Source; change: string; source: string };

export function applyReview(entities: ArcEntity[], corrections: CorrectionEntry[], items: ReviewItem[], day: string): { entities: ArcEntity[]; corrections: CorrectionEntry[] } {
  const out = structuredClone(entities), log = [...corrections];
  let next = Math.max(0, ...log.map((c) => c.id)) + 1;
  for (const it of items) {
    const e = out.find((x) => x.slug === it.slug);
    if (!e) throw new Error(`unknown slug ${it.slug}`);
    if (it.set.status && !it.evidence) throw new Error(`${it.slug}: status needs evidence`);
    const fl = it.set.first_live;
    if (typeof fl === "string" && it.evidence?.date !== fl && ![...e.status_evidence, ...e.sources].some((s) => s.date === fl))
      throw new Error(`${it.slug}: date must match its evidence`);
    if (it.evidence) {
      const have = e.status_evidence.find((s) => s.url === it.evidence!.url);
      // the date on evidence that sets a launch date is the launch date it states (older entries carry the day we read them)
      if (have) { if (it.evidence.title) have.title = it.evidence.title; have.date = typeof fl === "string" ? fl : have.date ?? it.evidence.date; have.type ??= it.evidence.type; }
      else e.status_evidence.push({ ...it.evidence });
    }
    if (fl === null) delete e.first_live; else if (fl !== undefined) e.first_live = fl;
    if (it.set.status) e.status = it.set.status;
    if (it.set.category) e.category = it.set.category;
    if (it.set.add_tags || it.set.category) {
      const tags = [...new Set([...(e.tags ?? []), ...(it.set.add_tags ?? [])])].filter((t) => t !== e.category);
      if (tags.length) e.tags = tags; else delete e.tags;
    }
    e.last_reviewed = day;
    const dup = log.some((c) => c.slug === it.slug && c.field === it.field && c.change === it.change && c.date === day);
    if (!dup) log.push({ id: next++, date: day, slug: it.slug, field: it.field, change: it.change, source: it.source, from: "review" });
  }
  return { entities: out, corrections: log };
}
