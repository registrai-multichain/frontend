import type { PagesFunction } from "../../../../lib/env";
import { handleAdminProject, handleAdminProjects } from "../../../../lib/projects";
import { sourceParam } from "../../../../lib/source-param";

/**
 * GET / PUT /api/admin/projects/<encodeURIComponent(source)>, and GET of the bare
 * /api/admin/projects: Pages routes the bare path to this optional catch-all, not to
 * index.ts (the middleware has checked the session).
 */
export const onRequest: PagesFunction<{ admin?: string }> = ({ request, env, params, data }) =>
  params.source === undefined || (Array.isArray(params.source) && params.source.length === 0)
    ? handleAdminProjects(request, env)
    : handleAdminProject(request, env, sourceParam(params.source), data.admin ?? "");
