import type { PagesFunction } from "../../../../lib/env";
import { handleBotVerify } from "../../../../lib/verify";

/** POST /api/bot/facts/verify — the radar's evidence re-check results (Bearer RADAR_PUBLISH_SECRET). */
export const onRequest: PagesFunction = ({ request, env }) => handleBotVerify(request, env);
