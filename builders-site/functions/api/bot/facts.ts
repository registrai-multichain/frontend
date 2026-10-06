import type { PagesFunction } from "../../../lib/env";
import { handleBotFacts } from "../../../lib/verify";

/** GET /api/bot/facts — every source's facts, embargoed included (Bearer RADAR_PUBLISH_SECRET). */
export const onRequest: PagesFunction = ({ request, env }) => handleBotFacts(request, env);
