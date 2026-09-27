import type { PagesFunction } from "../../../../lib/env";
import { handleAdminPatch } from "../../../../lib/market-proposals";

/** PATCH /api/admin/market-proposals/<id> — edit a proposal (clears its signature). */
export const onRequestPatch: PagesFunction<{ admin?: string }> = ({ request, env, params, data }) =>
  handleAdminPatch(request, env, String(params.id), String(data.admin));
