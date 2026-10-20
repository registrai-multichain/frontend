/** GET /api/v1/ecosystem[/{slug}]: the Arc ecosystem directory as JSON (CC BY 4.0). Static data: cached 5 min. */
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import { categoryOf, entityHref, parseStatus, sortByName } from "../../src/lib/arc-ecosystem";
import { cached, v1Error, v1Json } from "./data-api";
import type { EdgeCacheDeps } from "./http";

const SITE = "https://builder.registrai.cc";
export function handleEcosystem(req: Request, deps: EdgeCacheDeps, parts: string[]): Promise<Response> {
  const url = new URL(req.url);
  if (parts.length > 1) return Promise.resolve(v1Error(404, "Not found. Use /api/v1/ecosystem or /api/v1/ecosystem/{slug}."));
  if (parts.length === 1) {
    const e = ECOSYSTEM.bySlug.get(parts[0]);
    if (!e) return Promise.resolve(v1Error(404, `No project with slug ${parts[0]}. Use /api/v1/ecosystem for the list.`));
    return cached(req, deps, `eco:${e.slug}`, () => v1Json(req, { entity: { ...e, url: `${SITE}${entityHref(e.slug)}` } }, 300), 300);
  }
  const cat = url.searchParams.get("category"), st = url.searchParams.get("status"), q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (cat !== null && !categoryOf(cat)) return Promise.resolve(v1Error(400, "category must be one of the directory's category ids (see /ecosystem/)."));
  const status = st === null ? null : parseStatus(st);
  if (st !== null && !status) return Promise.resolve(v1Error(400, "status must be live, deployed or announced."));
  return cached(req, deps, `eco-list:${cat ?? ""}:${status ?? ""}:${q}`, () => {
    const l = sortByName(ECOSYSTEM.entities).filter((e) => (!cat || e.category === cat || (e.tags ?? []).includes(cat as never)) && (!status || e.status === status)
      && (!q || [e.name, ...(e.aliases ?? [])].some((n) => n.toLowerCase().includes(q))));
    return v1Json(req, {
      updated: ECOSYSTEM.entities.map((e) => e.last_reviewed).sort().pop() ?? null, count: l.length,
      entities: l.map((e) => ({ slug: e.slug, name: e.name, category: e.category, status: e.status, summary: e.summary, website: e.website ?? null, first_live: e.first_live ?? null, url: `${SITE}${entityHref(e.slug)}` })),
    }, 300);
  }, 300);
}
