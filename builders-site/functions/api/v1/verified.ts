import type { PagesFunction } from "../../../lib/env";
import { handleVerified } from "../../../lib/data-api-verified";

/** GET /api/v1/verified (Data API v1, public; KV 5 min + edge 5 min). */
export const onRequest: PagesFunction = (ctx) => handleVerified(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
