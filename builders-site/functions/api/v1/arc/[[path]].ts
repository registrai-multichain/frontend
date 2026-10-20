import type { PagesFunction } from "../../../../lib/env";
import { handleArc } from "../../../../lib/data-api-arc";

/** GET /api/v1/arc and /api/v1/arc/daily. */
export const onRequest: PagesFunction = (ctx) =>
  handleArc(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) }, ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean));
