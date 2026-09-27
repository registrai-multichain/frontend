import type { PagesFunction } from "../../../../lib/env";
import { handleAdminProjects } from "../../../../lib/projects";

/** GET /api/admin/projects (the middleware has checked the session). */
export const onRequest: PagesFunction = ({ request, env }) => handleAdminProjects(request, env);
