import type { PagesFunction } from "../../../../lib/env";
import { handleMemberHourly, handleMembers, handleMembersHourly, handleMembersNew, parseIndex, v1Error } from "../../../../lib/data-api";

/** GET /api/v1/members[/hourly|/new|/{id}/hourly]?index=abi|aii|aei (Data API v1, public). Member ids contain ':' so never collide with "hourly"/"new". */
export const onRequest: PagesFunction = (ctx) => {
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const index = parseIndex(new URL(ctx.request.url).searchParams.get("index"));
  if (!index) return v1Error(400, "index is required: abi, aii or aei.");
  const parts = ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean);
  if (parts.length === 0) return handleMembers(ctx.request, ctx.env, index, deps);
  if (parts.length === 1 && parts[0] === "hourly") return handleMembersHourly(ctx.request, ctx.env, index, deps);
  if (parts.length === 1 && parts[0] === "new") return handleMembersNew(ctx.request, ctx.env, index, deps);
  if (parts.length === 2 && parts[1] === "hourly") {
    let id: string;
    try { id = decodeURIComponent(parts[0]); } catch { return v1Error(400, "The member id is not valid URL encoding."); }
    return handleMemberHourly(ctx.request, ctx.env, index, id, deps);
  }
  return v1Error(404, "Unknown endpoint. See https://builder.registrai.cc/data-api/");
};
