import type { PagesFunction } from "../../../lib/env";
import { handlePublicFacts } from "../../../lib/facts";
import { sourceParam } from "../../../lib/source-param";

/** GET /api/facts/<encodeURIComponent(source)> (public). */
export const onRequestGet: PagesFunction = ({ request, env, params }) => handlePublicFacts(request, env, sourceParam(params.source));
