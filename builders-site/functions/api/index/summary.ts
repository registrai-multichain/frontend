import type { PagesFunction } from "../../../lib/env";
import { handleIndexSummary } from "../../../lib/builders-index";

/** /api/index/summary: each index's last closed value for the index tabs (spec §17); GET only, edge-cached 30 s. */
export const onRequest: PagesFunction = (ctx) => handleIndexSummary(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
