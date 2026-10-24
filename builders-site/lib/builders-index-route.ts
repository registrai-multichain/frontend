/** /builders-index/: the static page plus a server-rendered summary of the closes and the most used apps (lib/ssr-summary.ts).
 *  Shared by functions/builders-index/index.ts (the page) and index.md.ts (its Markdown copy). */
import type { PagesFunction } from "./env";
import { handleIndices } from "./data-api";
import { loadAppList } from "./apps-data";
import { renderIndexSummary, withSummary } from "./ssr-summary";

export const builderIndexPage: PagesFunction = async (ctx) => {
  if (!["GET", "HEAD"].includes(ctx.request.method.toUpperCase())) return ctx.next();
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  // ctx.next(ctx.request): the static page at the request's URL (for …/index.md the wrapper has rewritten it to the page)
  return withSummary(ctx.request, () => ctx.next(ctx.request), async () => {
    const r = await handleIndices(new Request(`${new URL(ctx.request.url).origin}/api/v1/indices`), ctx.env, deps);
    if (r.status !== 200) return null;
    return renderIndexSummary(await r.json(), await loadAppList(ctx.env, deps).catch(() => null));
  });
};
