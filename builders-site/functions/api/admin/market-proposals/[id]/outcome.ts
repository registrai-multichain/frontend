import type { PagesFunction } from "../../../../../lib/env";
import { handleAdminOutcome } from "../../../../../lib/market-proposals";

/** POST /api/admin/market-proposals/<id>/outcome {message, signature} */
export const onRequestPost: PagesFunction<{ admin?: string }> = ({ request, env, params, data }) =>
  handleAdminOutcome(request, env, String(params.id), String(data.admin));
