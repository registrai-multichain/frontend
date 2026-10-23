import type { PagesFunction } from "../../lib/env";
import { withMarkdown } from "../../lib/markdown-route";
import { readArcDaily } from "../../lib/arc-daily";
import { share7d } from "../../lib/arc-share";
import { indexFile } from "../../lib/data-api";
import { renderEcosystemNotFound } from "../../lib/ecosystem-pages";
import { edgeCachedGet } from "../../lib/http";
import { renderMethodology } from "../../lib/methodology-page";

/** GET /methodology/ (spec 2026-10-22-methodology-page-design.md), edge-cached 10 min. */
const html = (body: string, status = 200, head = false) =>
  new Response(head ? null : body, { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": status === 200 ? "public, max-age=600" : "no-store" } });

const htmlPages: PagesFunction = async (ctx) => {
  const req = ctx.request, url = new URL(req.url), m = req.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  const head = m === "HEAD";
  if (([] as string[]).concat(ctx.params.path ?? []).filter(Boolean).length) return html(renderEcosystemNotFound(), 404, head);
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const res = await edgeCachedGet(new Request(`${url.origin}/methodology/`), deps, async () => {
    const [aei, days] = await Promise.all([indexFile(ctx.env, "aei").catch(() => null), ctx.env.DATA_DB ? readArcDaily(ctx.env.DATA_DB, 7).catch(() => []) : Promise.resolve([])]);
    const f = aei as { params?: Record<string, number>; live?: { base_window?: number; base_scale?: number }; data_until?: string } | null;
    const params = f?.params ? { ...f.params, ...(f.live?.base_window !== undefined ? { base_window: f.live.base_window } : {}), ...(f.live?.base_scale !== undefined ? { base_scale: f.live.base_scale } : {}) } : null;
    return html(renderMethodology({ params, share: share7d(days), until: f?.data_until ?? null }));
  }, 600, "methodology");
  return head ? new Response(null, { status: res.status, headers: res.headers }) : res;
};

/** …/index.md: the Markdown copy of the same page (spec 2026-10-23-machine-readable-copies-design.md). */
export const onRequest: PagesFunction = withMarkdown(htmlPages);
