import type { PagesFunction } from "../../../lib/env";
import { handleAdminRegisterRequests } from "../../../lib/register-requests";

/** GET / DELETE /api/admin/register-requests (the middleware has checked the session). */
export const onRequest: PagesFunction = ({ request, env }) => handleAdminRegisterRequests(request, env);
