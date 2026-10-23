import type { PagesFunction } from "../../../lib/env";
import { handleOrder } from "../../../lib/pilot";

/** /api/pilot/order: POST queues an open order (fills at the next mark); GET ?id= its status (builders-site/lib/pilot.ts). */
export const onRequest: PagesFunction = ({ request, env }) => handleOrder(request, env);
