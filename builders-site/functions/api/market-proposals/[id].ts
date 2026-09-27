import type { PagesFunction } from "../../../lib/env";
import { handleStatus } from "../../../lib/market-proposals";

/** GET /api/market-proposals/<id> — the proposal's public status (no contact). */
export const onRequestGet: PagesFunction = ({ request, env, params }) => handleStatus(request, env, String(params.id));
