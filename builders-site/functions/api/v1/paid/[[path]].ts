import type { PagesFunction } from "../../../../lib/env";
import { handlePaid } from "../../../../lib/x402-products";

/** /api/v1/paid/*: x402 paid extras (catalogue, health and stats are free). */
export const onRequest: PagesFunction = (ctx) =>
  handlePaid(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) }, ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean));
