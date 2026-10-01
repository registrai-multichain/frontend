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
