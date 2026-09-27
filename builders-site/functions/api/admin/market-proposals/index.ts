import type { PagesFunction } from "../../../../lib/env";
import { handleAdminList } from "../../../../lib/market-proposals";

/** GET /api/admin/market-proposals?status= (the middleware has checked the session). */
export const onRequestGet: PagesFunction = ({ request, env }) => handleAdminList(request, env);
