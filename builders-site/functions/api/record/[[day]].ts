import type { PagesFunction } from "../../../lib/env";
import { handlePublicRecord } from "../../../lib/record";

/** GET /api/record (index) and GET /api/record/<day>.json (the exact hashed bytes). Public. */
export const onRequestGet: PagesFunction = (ctx) => handlePublicRecord(ctx.request, ctx.env, ctx.params.day, { waitUntil: (p) => ctx.waitUntil(p) });
