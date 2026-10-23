import { normalizeSource } from "./verified-builders";
import { validateFacts, type FactsInput, type ProjectFacts } from "./facts";

export function editorDraft(p: ProjectFacts): string {
  const out: Record<string, unknown> = { rev: p.rev };
  if (p.summary) out.summary = p.summary;
  if (p.offArc?.length) out.offArc = p.offArc;
  out.facts = p.facts;
  return JSON.stringify(out, null, 2);
}

export function parseDraft(text: string, source: string): { ok: true; value: FactsInput } | { ok: false; error: string } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${(e as Error).message}` };
  }
  return validateFacts(body, source);
}

/** Every known source for the facts picker: the union of the lists already loaded, de-duplicated and sorted. */
export function factsSources(...lists: ReadonlyArray<Iterable<string> | null | undefined>): string[] {
  const out = new Set<string>();
  for (const l of lists) for (const s of l ?? []) if (s) out.add(s);
  return [...out].sort((x, y) => x.localeCompare(y));
}

/** Typed input must already be a canonical source (normalizeSource(raw) === raw). */
export function canonicalSourceInput(raw: string): { ok: true; source: string } | { ok: false; error: string } {
  const raw1 = raw.trim();
  if (!raw1) return { ok: false, error: "" };
  return normalizeSource(raw1) === raw1 ? { ok: true, source: raw1 } : { ok: false, error: "not a canonical source" };
}

/**
 * The admin facts source box: a picked source takes effect at once; a typed one only once
 * committed (Enter or blur), so the partial strings typed on the way never remount the editor
 * or fire a GET. A committed canonical source wins over the pick.
 */
export interface SourceBox { picked: string; typed: string; committed: string }
export type SourceBoxAction = { type: "pick"; value: string } | { type: "type"; value: string } | { type: "commit" };
export const SOURCE_BOX: SourceBox = { picked: "", typed: "", committed: "" };

export function sourceBox(s: SourceBox, a: SourceBoxAction): SourceBox {
  if (a.type === "pick") return { picked: a.value, typed: "", committed: "" };
  if (a.type === "type") return { ...s, typed: a.value };
  return { ...s, committed: s.typed };
}

export function boxSource(s: SourceBox): { source: string; error: string } {
  const c = canonicalSourceInput(s.committed);
  return c.ok ? { source: c.source, error: "" } : { source: s.picked, error: c.error };
}
