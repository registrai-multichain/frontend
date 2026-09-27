import type { PagesFunction } from "../../../../lib/env";
import { handleAdminDraft } from "../../../../lib/drafts";
import { sourceParam } from "../../../../lib/source-param";

/** DELETE /api/admin/drafts/<encodeURIComponent(source)> (the middleware has checked the session). */
export const onRequest: PagesFunction = ({ request, env, params }) => handleAdminDraft(request, env, sourceParam(params.source));
