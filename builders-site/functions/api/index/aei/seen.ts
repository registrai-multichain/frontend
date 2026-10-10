import type { PagesFunction } from "../../../../lib/env";
import { handlePublicSeen, handlePushSeen } from "../../../../lib/builders-index";

/** /api/index/aei/seen: the AEI seen-wallets file (spec §17). POST (Bearer ABI_PUSH_TOKEN) stores it; GET serves it (edge-cached 30 s). */
export const onRequest: PagesFunction = (ctx) =>
  ctx.request.method.toUpperCase() === "POST" ? handlePushSeen(ctx.request, ctx.env, "aei") : handlePublicSeen(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) }, "aei");
