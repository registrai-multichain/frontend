import type { PagesFunction } from "../../../lib/env";
import { handlePublicIndex, handlePushIndex } from "../../../lib/builders-index";

/** /api/index: POST (Bearer ABI_PUSH_TOKEN) stores the Arc Builders Index file; GET serves it (edge-cached 60 s). */
export const onRequest: PagesFunction = (ctx) =>
  ctx.request.method.toUpperCase() === "POST" ? handlePushIndex(ctx.request, ctx.env) : handlePublicIndex(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
