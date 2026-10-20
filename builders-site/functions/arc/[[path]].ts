import type { PagesFunction } from "../../lib/env";
import { collectArcNumbers } from "../../lib/arc-numbers";
import { readArcDaily } from "../../lib/arc-daily";
import { renderArc } from "../../lib/arc-pages";
import { renderEcosystemNotFound } from "../../lib/ecosystem-pages";
import { edgeCachedGet } from "../../lib/http";

/** GET /arc/: Arc in numbers (live figures, edge-cached 10 min, plus the last 30 daily snapshots). */
const html = (body: string, status = 200, head = false) =>
  new Response(head ? null : body, { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": status === 200 ? "public, max-age=600" : "no-store" } });

export const onRequest: PagesFunction = async (ctx) => {
  const req = ctx.request, url = new URL(req.url), m = req.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  if (([] as string[]).concat(ctx.params.path ?? []).filter(Boolean).length) return html(renderEcosystemNotFound(), 404, m === "HEAD");
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const res = await edgeCachedGet(new Request(`${url.origin}/arc/`), deps, async () => {
    const [n, history] = await Promise.all([collectArcNumbers(ctx.env), ctx.env.DATA_DB ? readArcDaily(ctx.env.DATA_DB, 30).catch(() => []) : Promise.resolve([])]);
    return html(renderArc(n, history));
  }, 600, "arc");
  return m === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
};
