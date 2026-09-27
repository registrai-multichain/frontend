/**
 * Project profiles (contract: src/lib/projects.ts; spec: wonder-metrics-design and
 * admin-console-design §9). A profile is what the owner declares after the manual
 * investigation: deployers, contracts, token, X, and which metrics to track. The
 * keeper reads the public view to provision one feed per metric.
 *
 *   GET  /api/admin/projects            every known project (profiles, invites, suggestions) with its status
 *   GET  /api/admin/projects/<source>   { profile, feeds }
 *   PUT  /api/admin/projects/<source>   full profile (admin session; the middleware refuses onboarders)
 *   GET  /api/projects/<source>         public: { profile, feeds } without red flags or notes
 *
 * KV `project:<source>` -> ProjectProfile. Feeds are [] until the feed reader lands.
 */
import {
  publicProfile,
  validateProfile,
  type MetricFeedView,
  type ProjectListItem,
  type ProjectProfile,
  type ProjectStatus,
} from "../../src/lib/projects";
import { normalizeSource } from "../../src/lib/verified-builders";
import type { Env, KV } from "./env";
import { errorJson, json, readJson } from "./http";
import { readIndex } from "./invites";
import { listSuggestions } from "./suggestions";

export const PROJECT_PREFIX = "project:";
const key = (source: string) => `${PROJECT_PREFIX}${source}`;

function parseProfile(text: string | null): ProjectProfile | null {
  if (!text) return null;
  try {
    const p = JSON.parse(text) as ProjectProfile;
    return typeof p?.source === "string" && typeof p.name === "string" && Array.isArray(p.metrics) ? p : null;
  } catch {
    return null;
  }
}

export async function getProfile(kv: KV, source: string): Promise<ProjectProfile | null> {
  return parseProfile(await kv.get(key(source)));
}

/** The feeds of a project (the feed reader fills this in; none yet). */
async function feedsOf(_env: Env, _profile: ProjectProfile): Promise<MetricFeedView[]> {
  void _env;
  void _profile;
  return [];
}

/** A site for a source with no declared website yet. */
function siteOf(source: string): string {
  return source.startsWith("github:") ? `https://github.com/${source.slice(7)}` : `https://${source.slice(7)}`;
}

/** A minimal profile standing in for a project that has none yet. */
function stub(source: string, fields: { name?: string; website?: string; x?: string; github?: string }): ProjectProfile {
  const out: ProjectProfile = {
    source,
    name: fields.name ?? source,
    website: fields.website ?? siteOf(source),
    deployers: [],
    contracts: [],
    metrics: [],
    declaredBy: "",
    declaredAt: "",
  };
  if (fields.x) out.x = fields.x;
  if (fields.github) out.github = fields.github;
  return out;
}

/** GET /api/admin/projects */
export async function handleAdminProjects(req: Request, env: Env): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const items = new Map<string, ProjectListItem>();
  const status = new Map<string, ProjectStatus>();

  for (const s of await listSuggestions(env.INVITES)) {
    status.set(s.source, "suggested");
    items.set(s.source, { ...stub(s.source, s), status: "suggested" });
  }
  for (const inv of await readIndex(env.INVITES)) {
    status.set(inv.source, "invited");
    const prev = items.get(inv.source);
    items.set(inv.source, { ...(prev ?? stub(inv.source, inv)), name: inv.name ?? prev?.name ?? inv.source, ...(inv.x ? { x: inv.x } : {}), status: "invited" });
  }
  let cursor: string | undefined;
  do {
    const page = await env.INVITES.list({ prefix: PROJECT_PREFIX, cursor });
    for (const k of page.keys) {
      const p = parseProfile(await env.INVITES.get(k.name));
      if (p) items.set(p.source, { ...p, status: status.get(p.source) ?? "suggested" });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const projects = [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
  return json({ projects });
}

/** GET / PUT /api/admin/projects/<source> (the middleware has checked the session; PUT also CSRF and admin role). */
export async function handleAdminProject(req: Request, env: Env, rawSource: string, admin: string, deps: { now?: number } = {}): Promise<Response> {
  const source = normalizeSource(rawSource);
  if (!source || source !== rawSource) return errorJson(400, "not a canonical source");
  const method = req.method.toUpperCase();
  if (method === "GET") {
    const profile = await getProfile(env.INVITES, source);
    if (!profile) return errorJson(404, "no profile for this project yet");
    return json({ profile, feeds: await feedsOf(env, profile) });
  }
  if (method === "PUT") {
    const v = validateProfile(await readJson(req), source);
    if (!v.ok) return errorJson(400, v.error);
    const profile: ProjectProfile = { ...v.value, declaredBy: admin.toLowerCase(), declaredAt: new Date(deps.now ?? Date.now()).toISOString() };
    await env.INVITES.put(key(source), JSON.stringify(profile), { metadata: { source, name: profile.name } });
    return json({ profile });
  }
  return errorJson(405, "method not allowed");
}

/** GET /api/projects/<source> (public). */
export async function handlePublicProject(req: Request, env: Env, rawSource: string): Promise<Response> {
  if (req.method.toUpperCase() !== "GET") return errorJson(405, "method not allowed");
  const source = normalizeSource(rawSource);
  if (!source || source !== rawSource) return errorJson(400, "not a canonical source");
  const profile = await getProfile(env.INVITES, source);
  if (!profile) return errorJson(404, "no profile for this project");
  return json({ profile: publicProfile(profile), feeds: await feedsOf(env, profile) }, 200, { "cache-control": "public, max-age=60" });
}
