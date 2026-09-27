import type { PagesFunction } from "../../../lib/env";
import { handleApprovedFeed } from "../../../lib/market-proposals";

/** GET /api/market-proposals/approved — the rounds agent's feed (the signature is the authority). */
export const onRequestGet: PagesFunction = ({ request, env }) => handleApprovedFeed(request, env);
