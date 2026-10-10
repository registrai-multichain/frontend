import type { PagesFunction } from "../../../../lib/env";
import { handlePublicIndex, handlePushIndex } from "../../../../lib/builders-index";

/** /api/index/aii: the AII file (spec §17). POST (Bearer ABI_PUSH_TOKEN) stores it; GET serves it (edge-cached 30 s). */
export const onRequest: PagesFunction = (ctx) =>
  ctx.request.method.toUpperCase() === "POST" ? handlePushIndex(ctx.request, ctx.env, "aii") : handlePublicIndex(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) }, "aii");
