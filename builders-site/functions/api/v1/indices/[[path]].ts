import type { PagesFunction } from "../../../../lib/env";
import { handleIndexHourly, handleIndices, parseIndex, v1Error } from "../../../../lib/data-api";

/** GET /api/v1/indices and /api/v1/indices/{abi|aii|aei}/hourly (Data API v1, public). */
export const onRequest: PagesFunction = (ctx) => {
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const parts = ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean);
  if (parts.length === 0) return handleIndices(ctx.request, ctx.env, deps);
  const index = parseIndex(parts[0]);
  if (index && parts.length === 2 && parts[1] === "hourly") return handleIndexHourly(ctx.request, ctx.env, index, deps);
  return v1Error(404, "Unknown endpoint. See https://builder.registrai.cc/data-api/");
};
