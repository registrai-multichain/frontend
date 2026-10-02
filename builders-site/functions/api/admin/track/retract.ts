import type { Role } from "../../../../lib/auth";
import type { PagesFunction } from "../../../../lib/env";
import { handleAdminTrackRetract } from "../../../../lib/track";

/** POST /api/admin/track/retract (the middleware has checked the session, admin role and CSRF, and set the role). */
export const onRequest: PagesFunction<{ admin?: string; role?: Role }> = ({ request, env, data }) =>
  handleAdminTrackRetract(request, env, data.admin ?? "", data.role);
