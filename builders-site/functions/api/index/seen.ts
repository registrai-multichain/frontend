import type { PagesFunction } from "../../../lib/env";
import { handlePublicSeen, handlePushSeen } from "../../../lib/builders-index";

/** /api/index/seen: POST (Bearer ABI_PUSH_TOKEN) stores the seen-wallets file; GET serves it (edge-cached 30 s). */
export const onRequest: PagesFunction = (ctx) =>
  ctx.request.method.toUpperCase() === "POST" ? handlePushSeen(ctx.request, ctx.env) : handlePublicSeen(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
