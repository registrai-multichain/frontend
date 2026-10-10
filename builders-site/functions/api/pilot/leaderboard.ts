import type { PagesFunction } from "../../../lib/env";
import { handleLeaderboard } from "../../../lib/pilot";

/** /api/pilot/leaderboard: public, edge-cached 30 s (builders-site/lib/pilot.ts). */
export const onRequest: PagesFunction = (ctx) => handleLeaderboard(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
