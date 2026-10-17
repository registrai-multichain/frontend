import type { PagesFunction } from "../../lib/env";
import { handleIndices } from "../../lib/data-api";
import { loadAppList } from "../../lib/apps-data";
import { renderIndexSummary, withSummary } from "../../lib/ssr-summary";

/** GET /builders-index/: the static page plus a server-rendered summary of the closes and the most used apps (lib/ssr-summary.ts). */
export const onRequest: PagesFunction = async (ctx) => {
  if (!["GET", "HEAD"].includes(ctx.request.method.toUpperCase())) return ctx.next();
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  return withSummary(ctx.request, () => ctx.next(), async () => {
    const r = await handleIndices(new Request(`${new URL(ctx.request.url).origin}/api/v1/indices`), ctx.env, deps);
    if (r.status !== 200) return null;
    return renderIndexSummary(await r.json(), await loadAppList(ctx.env, deps).catch(() => null));
  });
};
