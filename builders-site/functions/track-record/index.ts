import type { PagesFunction } from "../../lib/env";
import { handlePublicTrack } from "../../lib/track";
import { renderTrackSummary, withSummary } from "../../lib/ssr-summary";

/** GET /track-record/: the static page plus a server-rendered summary of the published alerts (lib/ssr-summary.ts). */
export const onRequest: PagesFunction = async (ctx) => {
  if (!["GET", "HEAD"].includes(ctx.request.method.toUpperCase())) return ctx.next();
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  return withSummary(ctx.request, () => ctx.next(), async () => {
    const r = await handlePublicTrack(new Request(`${new URL(ctx.request.url).origin}/api/track`), ctx.env, deps);
    return r.status === 200 ? renderTrackSummary(await r.json()) : null;
  });
};
