import type { PagesFunction } from "../../lib/env";
import { loadApp, loadAppList, pathToId } from "../../lib/apps-data";
import { parseSort, renderApp, renderAppList, renderNotFound, renderUnavailable } from "../../lib/apps-pages";
import { edgeCachedGet } from "../../lib/http";
import { readArcDaily } from "../../lib/arc-daily";
import { share7d } from "../../lib/arc-share";
import { ECOSYSTEM } from "../../../src/lib/arc-ecosystem-data";
import { entityHref } from "../../../src/lib/arc-ecosystem";

/** GET /apps/ and /apps/<prefix>/<rest>/: server-rendered app facts for crawlers and agents (spec 2026-10-15-agent-reference-design.md). */
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": status === 200 ? "public, max-age=300" : "no-store" } });

export const onRequest: PagesFunction = async (ctx) => {
  const req = ctx.request, url = new URL(req.url);
  if (req.method.toUpperCase() !== "GET" && req.method.toUpperCase() !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const parts = ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean);
  if (parts.length === 0) {
    const sort = parseSort(url.searchParams.get("sort"));
    return edgeCachedGet(req, deps, async () => {
      const [l, days] = await Promise.all([loadAppList(ctx.env, deps), ctx.env.DATA_DB ? readArcDaily(ctx.env.DATA_DB, 7).catch(() => []) : Promise.resolve([])]);
      return l ? html(renderAppList(l, sort, share7d(days))) : html(renderUnavailable(), 503);
    }, 300, `list:${sort}`);
  }
  const id = pathToId(parts);
  if (!id) return html(renderNotFound(), 404);
  const claimed = ECOSYSTEM.byIndexId.get(id);
  if (claimed) return Response.redirect(`${url.origin}${entityHref(claimed.slug)}`, 301); // one page per project
  return edgeCachedGet(req, deps, async () => {
    const a = await loadApp(ctx.env, deps, id);
    if (a === null) return html(renderUnavailable(), 503);
    return a === "unknown" ? html(renderNotFound(), 404) : html(renderApp(a));
  }, 300, `app:${id}`);
};
