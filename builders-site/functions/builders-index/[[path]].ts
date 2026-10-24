import type { PagesFunction } from "../../lib/env";
import { handleIndices } from "../../lib/data-api";
import { loadAppList } from "../../lib/apps-data";
import { withMarkdown } from "../../lib/markdown-route";
import { renderIndexSummary, withSummary } from "../../lib/ssr-summary";

/** GET /builders-index/: the static page plus a server-rendered summary of the closes and the most used apps (lib/ssr-summary.ts). */
const htmlPage: PagesFunction = async (ctx) => {
  // a catch-all (for …/index.md): only the page itself gets the summary; Next's data files and anything else pass through
  if (!["GET", "HEAD"].includes(ctx.request.method.toUpperCase()) || new URL(ctx.request.url).pathname !== "/builders-index/") return ctx.next();
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  // ctx.next(ctx.request): the static page at the request's own URL (for …/index.md the wrapper has rewritten it to the page)
  return withSummary(ctx.request, () => ctx.next(ctx.request), async () => {
    const r = await handleIndices(new Request(`${new URL(ctx.request.url).origin}/api/v1/indices`), ctx.env, deps);
    if (r.status !== 200) return null;
    return renderIndexSummary(await r.json(), await loadAppList(ctx.env, deps).catch(() => null));
  });
};

/** …/index.md: the Markdown copy, converted from the server-rendered summary (spec 2026-10-23-machine-readable-copies-design.md). */
export const onRequest: PagesFunction = withMarkdown(htmlPage);
