/**
 * Public project facts: neutral, evidenced statements about a project, shown on
 * builder.registrai.cc/project/?source=<source>. Spec:
 * docs/superpowers/specs/2026-09-29-registrai-public-profiles-and-publication-policy.md
 * Kept OUT of ProjectProfile (projects.ts is a frozen contract and nominations hash it).
 *
 *   GET /api/facts/<encodeURIComponent(source)>        public (publishAt-filtered)
 *   GET /api/admin/facts/<encodeURIComponent(source)>  admin/onboarder session
 *   PUT /api/admin/facts/<encodeURIComponent(source)>  admin session: FactsInput (rev must match)
 */
export type FactTopic = "control" | "contracts" | "token" | "treasury" | "activity" | "claims" | "infrastructure";
export const FACT_TOPICS: readonly FactTopic[] = ["control", "contracts", "token", "treasury", "activity", "claims", "infrastructure"];

export interface Fact {
  id: string;
  topic: FactTopic;
  text: string;
  evidence: string[];
  observedAt: string;
  updatedAt: string;
  projectNote?: { text: string; at: string };
  supersededBy?: string;
  publishAt?: string;
}
export interface ChangeLogEntry { at: string; kind: "added" | "updated" | "superseded" | "removed" | "note"; factId: string; text: string; hiddenUntil?: string }
export interface ProjectFacts {
  source: string;
  summary?: string;
  offArc?: string[];
  facts: Fact[];
  changelog: ChangeLogEntry[];
  lastReviewedAt: string;
  reviewedBy: string;
  rev: number;
}
export type FactsInput = Pick<ProjectFacts, "summary" | "offArc" | "facts"> & { rev: number };

export const FACTS_LIMITS = { facts: 60, text: 300, note: 500, summary: 280, evidence: 5, changelog: 200, id: 40, offArc: 5, offArcItem: 60 } as const;
export const VERDICT_WORDS = ["scam", "rug", "rugged", "fraud", "fraudulent", "risky", "risk", "safe", "unsafe", "trustworthy", "untrustworthy", "legit", "shady", "suspicious", "dangerous", "red flag"] as const;
// "Safe" is a multisig product name, so safe/unsafe match lowercase only; the rest are case-insensitive.
const CASE_SENSITIVE = new Set<string>(["safe", "unsafe"]);
const wordsRe = (ws: readonly string[]) => ws.map((w) => w.replace(" ", "\\s+")).join("|");
const VERDICT_CI = new RegExp(`\\b(${wordsRe(VERDICT_WORDS.filter((w) => !CASE_SENSITIVE.has(w)))})\\b`, "i");
const VERDICT_CS = new RegExp(`\\b(${wordsRe(VERDICT_WORDS.filter((w) => CASE_SENSITIVE.has(w)))})\\b`);
const VERDICT_RE = { test: (t: string) => VERDICT_CI.test(t) || VERDICT_CS.test(t) };
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const EXPLORER = "https://explorer.arc.io";

function clean(raw: unknown, max: number): string | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length > max ? null : s;
}
function iso(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function evidenceItem(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (ADDR_RE.test(s) || HASH_RE.test(s)) return s.toLowerCase();
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function evidenceHref(e: string): string {
  if (ADDR_RE.test(e)) return `${EXPLORER}/address/${e.toLowerCase()}`;
  if (HASH_RE.test(e)) return `${EXPLORER}/tx/${e.toLowerCase()}`;
  const v = evidenceItem(e);
  return v ?? `${EXPLORER}/`;
}

export function validateFacts(body: unknown, source: string): { ok: true; value: FactsInput } | { ok: false; error: string } {
  void source;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "expected a JSON object" };
  const b = body as Record<string, unknown>;
  if (typeof b.rev !== "number" || !Number.isInteger(b.rev) || b.rev < 0) return { ok: false, error: "rev must be the revision you edited (a non-negative integer)" };
  const out: FactsInput = { rev: b.rev, facts: [] };
  const summary = clean(b.summary, FACTS_LIMITS.summary);
  if (summary === null) return { ok: false, error: `summary: at most ${FACTS_LIMITS.summary} characters` };
  if (summary) {
    if (VERDICT_RE.test(summary)) return { ok: false, error: "summary: describe, don't judge (verdict word found)" };
    out.summary = summary;
  }
  if (b.offArc !== undefined) {
    if (!Array.isArray(b.offArc) || b.offArc.length > FACTS_LIMITS.offArc) return { ok: false, error: `offArc: a list of at most ${FACTS_LIMITS.offArc}` };
    const items = b.offArc.map((x) => clean(x, FACTS_LIMITS.offArcItem));
    if (items.some((x) => x === null)) return { ok: false, error: `offArc: each at most ${FACTS_LIMITS.offArcItem} characters` };
    const kept = items.filter((x): x is string => Boolean(x));
    if (kept.length) out.offArc = kept;
  }
  if (!Array.isArray(b.facts)) return { ok: false, error: "facts must be a list" };
  if (b.facts.length > FACTS_LIMITS.facts) return { ok: false, error: `at most ${FACTS_LIMITS.facts} facts` };
  const ids = new Set<string>();
  for (const raw of b.facts) {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "each fact must be an object" };
    const f = raw as Record<string, unknown>;
    const id = typeof f.id === "string" ? f.id.trim() : "";
    if (!ID_RE.test(id)) return { ok: false, error: `fact id "${String(f.id)}": lowercase letters, digits and dashes` };
    if (ids.has(id)) return { ok: false, error: `fact id ${id} is used twice` };
    ids.add(id);
    if (!FACT_TOPICS.includes(f.topic as FactTopic)) return { ok: false, error: `fact ${id}: topic must be one of ${FACT_TOPICS.join(", ")}` };
    const text = clean(f.text, FACTS_LIMITS.text);
    if (!text) return { ok: false, error: `fact ${id}: text is required (at most ${FACTS_LIMITS.text} characters)` };
    if (VERDICT_RE.test(text)) return { ok: false, error: `fact ${id}: describe what you observed without verdict words (${VERDICT_WORDS.join(", ")})` };
    if (!Array.isArray(f.evidence) || f.evidence.length < 1 || f.evidence.length > FACTS_LIMITS.evidence) return { ok: false, error: `fact ${id}: 1 to ${FACTS_LIMITS.evidence} evidence links` };
    const evidence: string[] = [];
    for (const e of f.evidence) {
      const v = evidenceItem(e);
      if (!v) return { ok: false, error: `fact ${id}: evidence must be an https:// link, an address or a tx hash` };
      evidence.push(v);
    }
    const observedAt = iso(f.observedAt);
    if (!observedAt) return { ok: false, error: `fact ${id}: observedAt must be a date` };
    const fact: Fact = { id, topic: f.topic as FactTopic, text, evidence, observedAt, updatedAt: iso(f.updatedAt) ?? observedAt };
    if (f.projectNote !== undefined && f.projectNote !== null) {
      const n = f.projectNote as Record<string, unknown>;
      const nt = clean(n?.text, FACTS_LIMITS.note);
      const nat = iso(n?.at);
      if (!nt || !nat) return { ok: false, error: `fact ${id}: projectNote needs text (at most ${FACTS_LIMITS.note}) and a date` };
      fact.projectNote = { text: nt, at: nat };
    }
    if (f.supersededBy !== undefined && f.supersededBy !== null && f.supersededBy !== "") fact.supersededBy = String(f.supersededBy);
    if (f.publishAt !== undefined && f.publishAt !== null && f.publishAt !== "") {
      const p = iso(f.publishAt);
      if (!p) return { ok: false, error: `fact ${id}: publishAt must be a date` };
      fact.publishAt = p;
    }
    out.facts.push(fact);
  }
  for (const f of out.facts) {
    if (f.supersededBy && (!ids.has(f.supersededBy) || f.supersededBy === f.id)) return { ok: false, error: `fact ${f.id}: supersededBy must name another fact in this list` };
  }
  return { ok: true, value: out };
}

export function diffChangelog(prev: Fact[], next: Fact[], at: string): ChangeLogEntry[] {
  const before = new Map(prev.map((f) => [f.id, f]));
  const now = new Map(next.map((f) => [f.id, f]));
  const out: ChangeLogEntry[] = [];
  const push = (e: ChangeLogEntry, ...facts: (Fact | undefined)[]) => {
    const t = Date.parse(at);
    const until = facts.map((f) => f?.publishAt).filter((x): x is string => !!x && Date.parse(x) > t).sort().pop();
    out.push(until ? { ...e, hiddenUntil: until } : e);
  };
  for (const f of next) {
    const p = before.get(f.id);
    if (!p) { push({ at, kind: "added", factId: f.id, text: f.text }, f); continue; }
    if (p.text !== f.text || p.evidence.join() !== f.evidence.join() || p.topic !== f.topic) push({ at, kind: "updated", factId: f.id, text: f.text }, p, f);
    if (!p.supersededBy && f.supersededBy) push({ at, kind: "superseded", factId: f.id, text: `Superseded by ${f.supersededBy}` }, p, f, now.get(f.supersededBy));
    if (f.projectNote && f.projectNote.text !== p.projectNote?.text) push({ at, kind: "note", factId: f.id, text: f.projectNote.text }, p, f);
  }
  for (const p of prev) if (!now.has(p.id)) push({ at, kind: "removed", factId: p.id, text: p.text }, p);
  return out;
}

/** Shown once `at` is absent or a date at/before now; an unparseable date fails closed (stays hidden). */
const released = (at: string | undefined, now: number) => !at || Date.parse(at) <= now;

export function publicFacts(p: ProjectFacts, now: number): ProjectFacts {
  const hidden = new Set(p.facts.filter((f) => !released(f.publishAt, now)).map((f) => f.id));
  return {
    ...p,
    facts: p.facts.filter((f) => !hidden.has(f.id)).map(({ publishAt: _p, ...f }) => {
      void _p;
      if (f.supersededBy && hidden.has(f.supersededBy)) delete f.supersededBy;
      return f;
    }),
    changelog: p.changelog
      .filter((c) => !hidden.has(c.factId) && released(c.hiddenUntil, now))
      .map(({ hiddenUntil: _h, ...c }) => { void _h; return c; }),
  };
}
