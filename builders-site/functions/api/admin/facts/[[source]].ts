import type { Role } from "../../../../lib/auth";
import type { PagesFunction } from "../../../../lib/env";
import { handleAdminFacts } from "../../../../lib/facts";
import { sourceParam } from "../../../../lib/source-param";

/** GET / PUT /api/admin/facts/<encodeURIComponent(source)> (the middleware has checked the session, admin role for PUT and CSRF, and set the role). */
export const onRequest: PagesFunction<{ admin?: string; role?: Role }> = ({ request, env, params, data }) =>
  handleAdminFacts(request, env, sourceParam(params.source), data.admin ?? "", data.role);
