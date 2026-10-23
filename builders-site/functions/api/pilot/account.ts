import type { PagesFunction } from "../../../lib/env";
import { handleAccount } from "../../../lib/pilot";

/** /api/pilot/account (builders-site/lib/pilot.ts). */
export const onRequest: PagesFunction = ({ request, env }) => handleAccount(request, env);
