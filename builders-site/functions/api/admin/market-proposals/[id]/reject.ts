import type { PagesFunction } from "../../../../../lib/env";
import { handleAdminReject } from "../../../../../lib/market-proposals";

/** POST /api/admin/market-proposals/<id>/reject {reason} */
export const onRequestPost: PagesFunction = ({ request, env, params }) =>
  handleAdminReject(request, env, String(params.id));
