/** `<page>index.md`: the Markdown copy of a page, served by the page's own function (spec 2026-10-23-machine-readable-copies-design.md). */
import type { PagesFunction } from "./env";
import { htmlToMarkdown } from "./markdown";

const MD = "index.md";

/** Wraps a page function: `…/index.md` renders the page as HTML (same status, same edge cache) and converts it. */
export function withMarkdown(handler: PagesFunction): PagesFunction {
  return async (ctx) => {
    const url = new URL(ctx.request.url);
    if (!url.pathname.endsWith(`/${MD}`)) return handler(ctx);
    const m = ctx.request.method.toUpperCase();
    if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET, HEAD" } });
    const pageUrl = `${url.origin}${url.pathname.slice(0, -MD.length)}${url.search}`;
    const parts = ([] as string[]).concat(ctx.params.path ?? []).filter((p) => p && p !== MD);
    const res = await handler({ ...ctx, request: new Request(pageUrl, { method: "GET", headers: ctx.request.headers }), params: { ...ctx.params, path: parts } } as never);
    if (![200, 404, 410].includes(res.status)) return res;
    const html = await res.text();
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"\s*\/?>/)?.[1] ?? pageUrl;   // ours end ">", Next's "/>"
    const body = htmlToMarkdown(html, canonical);
    return new Response(m === "HEAD" ? null : body, { status: res.status, headers: {
      "content-type": "text/markdown; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": res.headers.get("cache-control") ?? "no-store" } });
  };
}
