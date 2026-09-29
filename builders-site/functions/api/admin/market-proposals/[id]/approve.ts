import type { PagesFunction } from "../../../../../lib/env";
import { PROPOSALS_CLOSED, handleAdminApprove, handleClosed } from "../../../../../lib/market-proposals";

/** POST /api/admin/market-proposals/<id>/approve {message, signature}
 *  Closed while markets are frozen: answers 410, nothing is approved. */
export const onRequestPost: PagesFunction<{ admin?: string }> = ({ request, env, params, data }) =>
  PROPOSALS_CLOSED ? handleClosed(env) : handleAdminApprove(request, env, String(params.id), String(data.admin));
