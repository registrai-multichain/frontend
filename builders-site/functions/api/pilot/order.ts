import type { PagesFunction } from "../../../lib/env";
import { handleOrder } from "../../../lib/pilot";

/** /api/pilot/order (builders-site/lib/pilot.ts). */
export const onRequest: PagesFunction = ({ request, env }) => handleOrder(request, env);
