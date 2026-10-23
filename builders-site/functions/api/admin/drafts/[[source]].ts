import type { PagesFunction } from "../../../../lib/env";
import { handleAdminDraft, handleAdminDrafts } from "../../../../lib/drafts";
import { sourceParam } from "../../../../lib/source-param";

/**
 * DELETE /api/admin/drafts/<encodeURIComponent(source)>, and GET / POST of the bare
 * /api/admin/drafts: Pages routes the bare path to this optional catch-all, not to
 * index.ts (the middleware has checked the session; POST also CSRF and admin role).
 */
export const onRequest: PagesFunction = ({ request, env, params }) =>
  params.source === undefined || (Array.isArray(params.source) && params.source.length === 0)
    ? handleAdminDrafts(request, env)
    : handleAdminDraft(request, env, sourceParam(params.source));
