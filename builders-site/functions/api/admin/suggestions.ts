import type { PagesFunction } from "../../../lib/env";
import { handleAdminSuggestions } from "../../../lib/suggestions";

/** GET / DELETE /api/admin/suggestions (the middleware has checked the session). */
export const onRequest: PagesFunction = ({ request, env }) => handleAdminSuggestions(request, env);
