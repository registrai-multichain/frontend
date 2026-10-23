import type { PagesFunction } from "../../../lib/env";
import { handleBotRecord } from "../../../lib/record";

/** POST /api/bot/record {day} — snapshot today's public state (UTC day) (Bearer RADAR_PUBLISH_SECRET). */
export const onRequest: PagesFunction = ({ request, env }) => handleBotRecord(request, env);
