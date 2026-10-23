import type { PagesFunction } from "../../../lib/env";
import { handlePositions } from "../../../lib/pilot";

/** /api/pilot/positions (builders-site/lib/pilot.ts). */
export const onRequest: PagesFunction = ({ request, env }) => handlePositions(request, env);
