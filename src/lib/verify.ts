/**
 * Verifier results (the radar's evidence re-check). KV `verify:<source>` and `verify:track` -> VerifyMap.
 *   POST /api/bot/facts/verify  { source | "track", results: { <id>: { ok, at, problems } } }
 * Embargoed facts are released only after a passing check (facts.ts publicFacts); public facts show verifiedAt.
 */
import { normalizeSource } from "./verified-builders";

export interface VerifyResult { ok: boolean; at: string; problems: string[] }
/** The latest result per id, plus the time of the most recent passing check. */
export type VerifyEntry = VerifyResult & { lastOk?: string };
export type VerifyMap = Record<string, VerifyEntry>;

export const VERIFY_LIMITS = { results: 500, problems: 3, problem: 120, map: 2500, futureMs: 5 * 60_000 } as const;
export const VERIFY_TRACK = "track";
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type VerifyInput = { ok: true; source: string; results: Record<string, VerifyResult> } | { ok: false; error: string };

export function validateVerifyInput(body: unknown, nowMs: number): VerifyInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "expected a JSON object" };
  const b = body as Record<string, unknown>;
  const src = b.source;
  if (typeof src !== "string" || (src !== VERIFY_TRACK && normalizeSource(src) !== src)) return { ok: false, error: 'source must be a canonical source or "track"' };
  if (typeof b.results !== "object" || b.results === null || Array.isArray(b.results)) return { ok: false, error: "results must be an object" };
  const entries = Object.entries(b.results as Record<string, unknown>);
  if (entries.length < 1 || entries.length > VERIFY_LIMITS.results) return { ok: false, error: `results: 1 to ${VERIFY_LIMITS.results} entries` };
  const results: Record<string, VerifyResult> = {};
  for (const [id, raw] of entries) {
    if (!ID_RE.test(id)) return { ok: false, error: `result id "${id}": lowercase letters, digits and dashes` };
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: `${id}: must be an object` };
    const r = raw as Record<string, unknown>;
    if (typeof r.ok !== "boolean") return { ok: false, error: `${id}: ok must be true or false` };
    const t = typeof r.at === "string" ? Date.parse(r.at) : NaN;
    if (!Number.isFinite(t)) return { ok: false, error: `${id}: at must be an ISO time` };
    if (t > nowMs + VERIFY_LIMITS.futureMs) return { ok: false, error: `${id}: at is in the future` };
    if (!Array.isArray(r.problems) || r.problems.length > VERIFY_LIMITS.problems) return { ok: false, error: `${id}: at most ${VERIFY_LIMITS.problems} problems` };
    for (const p of r.problems) if (typeof p !== "string" || p.length > VERIFY_LIMITS.problem) return { ok: false, error: `${id}: each problem is a string of at most ${VERIFY_LIMITS.problem} characters` };
    results[id] = { ok: r.ok, at: new Date(t).toISOString(), problems: r.problems as string[] };
  }
  return { ok: true, source: src, results };
}

/** Latest result per id (by `at`), lastOk = newest passing time ever seen. Pure; drops the oldest ids beyond the cap. */
export function mergeVerify(prev: VerifyMap, incoming: Record<string, VerifyResult>): VerifyMap {
  const out: VerifyMap = { ...prev };
  for (const [id, r] of Object.entries(incoming)) {
    const p = out[id];
    const lastOk = r.ok && (!p?.lastOk || r.at > p.lastOk) ? r.at : p?.lastOk;
    const latest = p && p.at > r.at ? { ok: p.ok, at: p.at, problems: p.problems } : { ok: r.ok, at: r.at, problems: r.problems };
    out[id] = lastOk ? { ...latest, lastOk } : latest;
  }
  const ids = Object.keys(out);
  if (ids.length <= VERIFY_LIMITS.map) return out;
  const keep = ids.sort((x, y) => (out[y].at < out[x].at ? -1 : out[y].at > out[x].at ? 1 : 0)).slice(0, VERIFY_LIMITS.map);
  return Object.fromEntries(keep.map((id) => [id, out[id]]));
}
