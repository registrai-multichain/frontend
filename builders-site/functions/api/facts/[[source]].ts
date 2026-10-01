import type { PagesFunction } from "../../../lib/env";
import { handlePublicFacts } from "../../../lib/facts";
import { sourceParam } from "../../../lib/source-param";

/** GET /api/facts/<encodeURIComponent(source)> (public; the edge keeps a 200 or 404 for 60 s). */
export const onRequestGet: PagesFunction = (ctx) =>
  handlePublicFacts(ctx.request, ctx.env, sourceParam(ctx.params.source), { waitUntil: (p) => ctx.waitUntil(p) });
