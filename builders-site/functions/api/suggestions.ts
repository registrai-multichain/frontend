import type { PagesFunction } from "../../lib/env";
import { handleSuggest } from "../../lib/suggestions";

/** POST /api/suggestions — /suggest's public form (same-origin JSON only, rate-limited). */
export const onRequestPost: PagesFunction = ({ request, env }) => handleSuggest(request, env);
