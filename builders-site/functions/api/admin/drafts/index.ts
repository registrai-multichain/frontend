import type { PagesFunction } from "../../../../lib/env";
import { handleAdminDrafts } from "../../../../lib/drafts";

/** GET / POST /api/admin/drafts (the middleware has checked the session; POST also CSRF and admin role). */
export const onRequest: PagesFunction = ({ request, env }) => handleAdminDrafts(request, env);
