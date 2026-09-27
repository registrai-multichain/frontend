import type { PagesFunction } from "../../../../lib/env";
import { handleAdminProject } from "../../../../lib/projects";
import { sourceParam } from "../../../../lib/source-param";

/** GET / PUT /api/admin/projects/<encodeURIComponent(source)> (the middleware has checked the session). */
export const onRequest: PagesFunction<{ admin?: string }> = ({ request, env, params, data }) =>
  handleAdminProject(request, env, sourceParam(params.source), data.admin ?? "");
