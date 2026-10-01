import type { PagesFunction } from "../../../../lib/env";
import { handleAdminFacts } from "../../../../lib/facts";
import { sourceParam } from "../../../../lib/source-param";

/** GET / PUT /api/admin/facts/<encodeURIComponent(source)> (the middleware has checked the session, admin role and CSRF). */
export const onRequest: PagesFunction<{ admin?: string }> = ({ request, env, params, data }) =>
  handleAdminFacts(request, env, sourceParam(params.source), data.admin ?? "");
