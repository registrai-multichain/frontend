import type { PagesFunction } from "../../../lib/env";
import { handlePublicProject } from "../../../lib/projects";
import { sourceParam } from "../../../lib/source-param";

/** GET /api/projects/<encodeURIComponent(source)> (public). */
export const onRequestGet: PagesFunction = ({ request, env, params }) => handlePublicProject(request, env, sourceParam(params.source));
