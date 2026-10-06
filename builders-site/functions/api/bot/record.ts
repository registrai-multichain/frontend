import type { PagesFunction } from "../../../lib/env";
import { handleBotRecord } from "../../../lib/record";

/** POST /api/bot/record {day} — snapshot a past UTC day (Bearer RADAR_PUBLISH_SECRET). */
export const onRequest: PagesFunction = ({ request, env }) => handleBotRecord(request, env);
