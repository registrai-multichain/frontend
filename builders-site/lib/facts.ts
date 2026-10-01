/**
 * Public project facts (contract: src/lib/facts.ts). KV `facts:<source>` -> ProjectFacts.
 *   GET /api/admin/facts/<source>  (session)      admin: editor state (empty rev 0 when none); onboarder: the public view
 *   PUT /api/admin/facts/<source>  (admin + CSRF, via the middleware) FactsInput; rev must match
 *   GET /api/facts/<source>        public, publishAt-filtered; reviewer "Registrai", no rev (publicResponse)
 * The change log is built only here, from the stored previous facts; a body changelog is ignored.
 */
import { diffChangelog, FACTS_LIMITS, publicFacts, publicResponse, validateFacts, type Fact, type ProjectFacts } from "../../src/lib/facts";
import { normalizeSource } from "../../src/lib/verified-builders";
import { ONBOARDER_READ_ONLY, type Role } from "./auth";
import type { Env, KV } from "./env";
import { errorJson, json, readJson } from "./http";

export const FACTS_PREFIX = "facts:";
const key = (source: string) => `${FACTS_PREFIX}${source}`;

export async function getFacts(kv: KV, source: string): Promise<ProjectFacts | null> {
  const text = await kv.get(key(source));
  if (!text) return null;
  try {
    const p = JSON.parse(text) as ProjectFacts;
    return p && p.source === source && Array.isArray(p.facts) ? p : null;
  } catch {
    return null;
  }
}

const empty = (source: string): ProjectFacts => ({ source, facts: [], changelog: [], lastReviewedAt: "", reviewedBy: "", rev: 0 });

function canonical(raw: string): string | null {
  const s = normalizeSource(raw);
  return s && s === raw ? s : null;
}

/** True when what a reader sees of the fact changed (observedAt and updatedAt aside). */
function factChanged(p: Fact, f: Fact): boolean {
  return p.text !== f.text || p.evidence.join() !== f.evidence.join() || p.topic !== f.topic ||
    p.projectNote?.text !== f.projectNote?.text || p.projectNote?.at !== f.projectNote?.at ||
    p.publishAt !== f.publishAt || p.supersededBy !== f.supersededBy;
}

/** updatedAt is the server's: now for a new or changed fact, the stored value otherwise (a body's is ignored). */
function stampUpdated(prev: Fact[], next: Fact[], at: string): Fact[] {
  const before = new Map(prev.map((f) => [f.id, f]));
  return next.map((f) => {
    const p = before.get(f.id);
    return { ...f, updatedAt: p && !factChanged(p, f) ? p.updatedAt : at };
  });
}

export async function handleAdminFacts(req: Request, env: Env, rawSource: string, admin: string, role: Role | undefined, deps: { now?: number } = {}): Promise<Response> {
  const source = canonical(rawSource);
  if (!source) return errorJson(400, "not a canonical source");
  const method = req.method.toUpperCase();
  const stored = (await getFacts(env.INVITES, source)) ?? empty(source);
  // Private-first: embargoed (publishAt) facts stay with the admins; an onboarder reads the public view.
  if (method === "GET") return json({ facts: role === "admin" ? stored : publicFacts(stored, deps.now ?? Date.now()) });
  if (method === "PUT") {
    if (role !== "admin") return errorJson(403, ONBOARDER_READ_ONLY);
    const v = validateFacts(await readJson(req), source);
    if (!v.ok) return errorJson(400, v.error);
    if (v.value.rev !== stored.rev) return errorJson(409, "someone saved a newer version; reload", { rev: stored.rev });
    const at = new Date(deps.now ?? Date.now()).toISOString();
    const next: ProjectFacts = {
      source,
      ...(v.value.summary ? { summary: v.value.summary } : {}),
      ...(v.value.offArc ? { offArc: v.value.offArc } : {}),
      facts: stampUpdated(stored.facts, v.value.facts, at),
      changelog: [...stored.changelog, ...diffChangelog(stored.facts, v.value.facts, at)].slice(-FACTS_LIMITS.changelog),
      lastReviewedAt: at,
      reviewedBy: admin.toLowerCase(),
      rev: stored.rev + 1,
    };
    await env.INVITES.put(key(source), JSON.stringify(next), { metadata: { source } });
    return json({ facts: next });
  }
  return errorJson(405, "method not allowed");
}

export async function handlePublicFacts(req: Request, env: Env, rawSource: string, deps: { now?: number } = {}): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const source = canonical(rawSource);
  if (!source) return errorJson(400, "not a canonical source");
  const stored = await getFacts(env.INVITES, source);
  if (!stored) return errorJson(404, "no facts for this project");
  return json({ facts: publicResponse(stored, deps.now ?? Date.now()) }, 200, { "cache-control": "public, max-age=60" });
}
