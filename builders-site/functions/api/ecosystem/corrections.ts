import type { PagesFunction } from "../../../lib/env";
import { handleCorrectionPost } from "../../../lib/corrections";

/** POST /api/ecosystem/corrections: the public corrections form (spec 2026-10-21-ecosystem-corrections-design.md). */
export const onRequest: PagesFunction = ({ request, env }) => handleCorrectionPost(request, env);
