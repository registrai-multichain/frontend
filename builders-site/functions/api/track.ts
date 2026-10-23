import type { PagesFunction } from "../../lib/env";
import { handlePublicTrack } from "../../lib/track";

/** GET /api/track (public; the edge keeps a 200 for 60 s; never writes). */
export const onRequest: PagesFunction = (ctx) => handlePublicTrack(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
