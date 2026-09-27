import type { PagesFunction } from "../../../../../lib/env";
import { handleAdminApprove } from "../../../../../lib/market-proposals";

/** POST /api/admin/market-proposals/<id>/approve {message, signature} */
export const onRequestPost: PagesFunction<{ admin?: string }> = ({ request, env, params, data }) =>
  handleAdminApprove(request, env, String(params.id), String(data.admin));
