import type { PagesFunction } from "../../../../lib/env";
import { handleEcosystem } from "../../../../lib/data-api-ecosystem";

/** GET /api/v1/ecosystem and /api/v1/ecosystem/{slug}. */
export const onRequest: PagesFunction = (ctx) =>
  handleEcosystem(ctx.request, { waitUntil: (p) => ctx.waitUntil(p) }, ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean));
