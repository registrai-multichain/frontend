import type { PagesFunction } from "../../../lib/env";
import { handleClose } from "../../../lib/pilot";

/** /api/pilot/close (builders-site/lib/pilot.ts). */
export const onRequest: PagesFunction = ({ request, env }) => handleClose(request, env);
