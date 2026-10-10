import type { PagesFunction } from "../../../lib/env";
import { handleFunding } from "../../../lib/pilot";

/** /api/pilot/funding: public, the last 24 hourly rates (v3: long, short, skew, trend), edge-cached 60 s (builders-site/lib/pilot.ts). */
export const onRequest: PagesFunction = (ctx) => handleFunding(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
