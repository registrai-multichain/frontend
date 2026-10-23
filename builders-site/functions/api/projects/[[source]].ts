import type { PagesFunction } from "../../../lib/env";
import { handlePublicProject } from "../../../lib/projects";
import { sourceParam } from "../../../lib/source-param";

/** GET /api/projects/<encodeURIComponent(source)> (public; the edge keeps a 200 or 404 for 60 s). */
export const onRequestGet: PagesFunction = (ctx) =>
  handlePublicProject(ctx.request, ctx.env, sourceParam(ctx.params.source), { waitUntil: (p) => ctx.waitUntil(p) });
