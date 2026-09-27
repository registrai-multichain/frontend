import type { PagesFunction } from "../../../../lib/env";
import { handleAdminList } from "../../../../lib/market-proposals";

/** GET /api/admin/market-proposals?cursor=&status= (the middleware has checked the session):
 *  one page of summaries from the keys' metadata, the next cursor, and the admin's last nonce. */
export const onRequestGet: PagesFunction<{ admin?: string }> = ({ request, env, data }) => handleAdminList(request, env, String(data.admin));
