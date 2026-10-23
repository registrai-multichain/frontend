import type { PagesFunction } from "../../../lib/env";
import { handleHistory } from "../../../lib/pilot";

/** /api/pilot/history (builders-site/lib/pilot.ts). */
export const onRequest: PagesFunction = ({ request, env }) => handleHistory(request, env);
