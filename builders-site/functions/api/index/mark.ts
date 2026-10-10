import type { PagesFunction } from "../../../lib/env";
import { handlePublicMark, handlePushMark } from "../../../lib/pilot";

/** /api/index/mark: POST (Bearer ABI_PUSH_TOKEN) stores the latest ABI mark and its minute bars (PILOT_DB); GET serves the latest mark (edge-cached 5 s). */
export const onRequest: PagesFunction = (ctx) =>
  ctx.request.method.toUpperCase() === "POST" ? handlePushMark(ctx.request, ctx.env) : handlePublicMark(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
