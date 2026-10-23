import type { PagesFunction } from "../../../lib/env";
import { handleEconomy } from "../../../lib/pilot";

/** /api/pilot/economy: public, skew, funding, the house, the fee pool, insurance and the weekly split, edge-cached 30 s (builders-site/lib/pilot.ts). */
export const onRequest: PagesFunction = (ctx) => handleEconomy(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
