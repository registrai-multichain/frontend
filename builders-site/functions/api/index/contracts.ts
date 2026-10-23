import type { PagesFunction } from "../../../lib/env";
import { handlePublicContracts, handlePushContracts } from "../../../lib/builders-index";

/** /api/index/contracts: the ABI contract map ("close the gaps"). POST (Bearer ABI_PUSH_TOKEN) stores it with its sha256; GET serves it (edge-cached 30 s). */
export const onRequest: PagesFunction = (ctx) =>
  ctx.request.method.toUpperCase() === "POST" ? handlePushContracts(ctx.request, ctx.env, "abi") : handlePublicContracts(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) }, "abi");
