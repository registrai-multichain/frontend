import type { PagesFunction } from "../../../lib/env";
import { handleBotTrack } from "../../../lib/track";

/** POST /api/bot/track — the radar keeper's batch (Bearer RADAR_PUBLISH_SECRET). */
export const onRequest: PagesFunction = ({ request, env }) => handleBotTrack(request, env);
