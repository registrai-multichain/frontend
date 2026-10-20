import type { ArcEntity } from "../../src/lib/arc-ecosystem";
import { pageState } from "../../src/lib/project-page";
import { loadApp } from "./apps-data";
import { handlePublicFacts } from "./facts";
import { handlePublicProject } from "./projects";
import type { Env } from "./env";
import type { EdgeCacheDeps } from "./http";
import type { EntityView } from "./ecosystem-pages";

const read = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => ({})) });

/** The entity plus its index activity and Tabula facts when available; never throws (missing data → null blocks). */
export async function loadEntityView(env: Env, deps: EdgeCacheDeps, e: ArcEntity, origin: string): Promise<EntityView> {
  const id = e.index_ids?.[0];
  const app = id ? await loadApp(env, deps, id).then((a) => (a && a !== "unknown" ? a : null)).catch(() => null) : null;
  let facts: EntityView["facts"] = null;
  if (e.facts_source) {
    try {
      const enc = encodeURIComponent(e.facts_source);
      const [p, f] = await Promise.all([
        handlePublicProject(new Request(`${origin}/api/projects/${enc}`), env, e.facts_source, deps).then(read),
        handlePublicFacts(new Request(`${origin}/api/facts/${enc}`), env, e.facts_source, deps).then(read),
      ]);
      const s = pageState(p, f);
      facts = s.kind === "ready" ? s : null;
    } catch { facts = null; }
  }
  return { entity: e, app, facts };
}
