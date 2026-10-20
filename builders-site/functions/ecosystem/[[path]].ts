import type { PagesFunction } from "../../lib/env";
import { ECOSYSTEM } from "../../../src/lib/arc-ecosystem-data";
import { categoryOf, parseStatus } from "../../../src/lib/arc-ecosystem";
import { renderCategory, renderDirectory, renderEcosystemNotFound, renderEntity } from "../../lib/ecosystem-pages";
import { loadEntityView } from "../../lib/ecosystem-load";
import { edgeCachedGet } from "../../lib/http";

/** GET /ecosystem/, /ecosystem/<category>/, /ecosystem/<slug>/ (spec 2026-10-19-arc-ecosystem-directory-design.md). */
const html = (body: string, status = 200, head = false) =>
  new Response(head ? null : body, { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": status === 200 ? "public, max-age=300" : "no-store" } });

export const onRequest: PagesFunction = async (ctx) => {
  const req = ctx.request, url = new URL(req.url), m = req.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  const head = m === "HEAD";
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const parts = ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean);
  const all = ECOSYSTEM.entities;
  if (parts.length === 0) {
    const status = parseStatus(url.searchParams.get("status"));
    return html(renderDirectory(all, status), 200, head);
  }
  if (parts.length !== 1) return html(renderEcosystemNotFound(), 404, head);
  const cat = categoryOf(parts[0]);
  if (cat) return html(renderCategory(cat, all), 200, head);
  const e = ECOSYSTEM.bySlug.get(parts[0]);
  if (!e) return html(renderEcosystemNotFound(), 404, head);
  const res = await edgeCachedGet(new Request(url.toString()), deps, async () => html(renderEntity(await loadEntityView(ctx.env, deps, e, url.origin))), 300, `entity:${e.slug}`);
  return head ? new Response(null, { status: res.status, headers: res.headers }) : res;
};
