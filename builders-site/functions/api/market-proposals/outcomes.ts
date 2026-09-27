import type { PagesFunction } from "../../../lib/env";
import { handleOutcomesFeed } from "../../../lib/market-proposals";

/** GET /api/market-proposals/outcomes — the rounds agent's signed-outcome feed. */
export const onRequestGet: PagesFunction = ({ request, env }) => handleOutcomesFeed(request, env);
