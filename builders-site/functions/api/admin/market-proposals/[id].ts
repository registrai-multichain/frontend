import type { PagesFunction } from "../../../../lib/env";
import { handleAdminGet, handleAdminPatch } from "../../../../lib/market-proposals";

/** GET /api/admin/market-proposals/<id> — the full record (the list carries summaries only). */
export const onRequestGet: PagesFunction = ({ env, params }) => handleAdminGet(env, String(params.id));
/** PATCH /api/admin/market-proposals/<id> — edit a proposal (clears its signature). */
export const onRequestPatch: PagesFunction<{ admin?: string }> = ({ request, env, params, data }) =>
  handleAdminPatch(request, env, String(params.id), String(data.admin));
